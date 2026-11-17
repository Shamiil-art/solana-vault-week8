import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { createMint, getAccount, getMint } from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { assert } from "chai";
import { SimpleVault } from "../target/types/simple_vault";

async function fundFromAdmin(
  provider: anchor.AnchorProvider,
  admin: Keypair,
  pubkey: PublicKey,
  lamports = 0.05 * LAMPORTS_PER_SOL
) {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: pubkey, lamports })
  );
  await provider.sendAndConfirm(tx, [admin]);
}

describe("simple_vault", () => {
  const url = process.env.ANCHOR_PROVIDER_URL;
  if (!url) throw new Error("ANCHOR_PROVIDER_URL is not defined");
  const provider = anchor.AnchorProvider.local(url, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = anchor.workspace.SimpleVault as Program<SimpleVault>;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const userA = Keypair.generate();
  const userB = Keypair.generate();

  let tokenMint: PublicKey;
  let vaultStatePDA: PublicKey;
  let vaultTokenAccountPDA: PublicKey;
  let shareMintPDA: PublicKey;

  const cardPda = (user: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePDA.toBuffer(), user.toBuffer()],
      program.programId
    )[0];

  before(async () => {
    await fundFromAdmin(provider, admin, userA.publicKey);
    await fundFromAdmin(provider, admin, userB.publicKey);

    tokenMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);

    [vaultStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tokenMint.toBuffer()],
      program.programId
    );
    [vaultTokenAccountPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_tokens"), tokenMint.toBuffer()],
      program.programId
    );
    [shareMintPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint"), tokenMint.toBuffer()],
      program.programId
    );
  });

  it("initialize_vault: vault создан", async () => {
    await program.methods
      .initializeVault()
      .accountsPartial({
        vaultState: vaultStatePDA,
        vaultTokenAccount: vaultTokenAccountPDA,
        shareMint: shareMintPDA,
        tokenMint,
        admin: admin.publicKey,
      })
      .rpc();

    const vault = await program.account.vaultState.fetch(vaultStatePDA);
    assert.isFalse(vault.paused);
    assert.equal(vault.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(vault.tokenMint.toBase58(), tokenMint.toBase58());
    assert.equal(vault.shareMint.toBase58(), shareMintPDA.toBase58());
    assert.equal(vault.vaultTokenAccount.toBase58(), vaultTokenAccountPDA.toBase58());

    const tokenAccount = await getAccount(provider.connection, vaultTokenAccountPDA);
    assert.equal(tokenAccount.owner.toBase58(), vaultStatePDA.toBase58());
    assert.equal(tokenAccount.mint.toBase58(), tokenMint.toBase58());
    const shares = await getMint(provider.connection, shareMintPDA);
    assert.equal(shares.mintAuthority?.toBase58(), vaultStatePDA.toBase58());
    assert.equal(shares.decimals, 6);
  });

  it("create_user_card: у каждого пользователя своя карточка", async () => {
    for (const user of [userA, userB]) {
      const userCard = cardPda(user.publicKey);
      await program.methods
        .createUserCard()
        .accountsPartial({ vaultState: vaultStatePDA, userCard, user: user.publicKey })
        .signers([user])
        .rpc();

      const card = await program.account.userCard.fetch(userCard);
      assert.isAbove(card.createdAt.toNumber(), 0);
      assert.equal(card.owner.toBase58(), user.publicKey.toBase58());
      assert.equal(card.vault.toBase58(), vaultStatePDA.toBase58());
    }
    assert.notEqual(cardPda(userA.publicKey).toBase58(), cardPda(userB.publicKey).toBase58());
  });

  it("create_user_card: вторая карточка для того же пользователя — ошибка", async () => {
    let failed = false;
    try {
      await program.methods
        .createUserCard()
        .accountsPartial({
          vaultState: vaultStatePDA,
          userCard: cardPda(userA.publicKey),
          user: userA.publicKey,
        })
        .signers([userA])
        .rpc();
    } catch {
      failed = true;
    }
    assert.isTrue(failed, "повторная карточка должна быть отклонена");
  });

  const setPaused = (signer: Keypair, paused: boolean) =>
    program.methods.setPaused(paused)
      .accountsPartial({ vaultState: vaultStatePDA, admin: signer.publicKey })
      .signers([signer]).rpc();

  const closeCard = (signer: Keypair, owner: PublicKey) =>
    program.methods.closeUserCard()
      .accountsPartial({ vaultState: vaultStatePDA, userCard: cardPda(owner), user: signer.publicKey })
      .signers([signer]).rpc();

  const createCard = (user: Keypair) =>
    program.methods.createUserCard()
      .accountsPartial({ vaultState: vaultStatePDA, userCard: cardPda(user.publicKey), user: user.publicKey })
      .signers([user]).rpc();

  async function expectAnchorError(run: () => Promise<string>, code: string) {
    try {
      await run();
    } catch (error) {
      assert.instanceOf(error, anchor.AnchorError);
      assert.equal((error as anchor.AnchorError).error.errorCode.code, code);
      return;
    }
    assert.fail(`Expected ${code}`);
  }

  it("set_paused: посторонний пользователь не может поставить vault на паузу", async () => {
    await expectAnchorError(() => setPaused(userA, true), "ConstraintHasOne");
  });

  it("close_user_card: только владелец закрывает карточку и получает ренту", async () => {
    await expectAnchorError(() => closeCard(userB, userA.publicKey), "ConstraintSeeds");
    const address = cardPda(userA.publicKey);
    const rent = (await provider.connection.getAccountInfo(address))!.lamports;
    const before = await provider.connection.getBalance(userA.publicKey);
    await closeCard(userA, userA.publicKey);
    assert.isNull(await program.account.userCard.fetchNullable(address));
    assert.equal(await provider.connection.getBalance(userA.publicKey), before + rent);
  });

  it("create_user_card: пауза блокирует создание карточки до возобновления", async () => {
    const address = cardPda(userA.publicKey);
    await setPaused(admin, true);
    await expectAnchorError(() => createCard(userA), "VaultPaused");
    assert.isNull(await program.account.userCard.fetchNullable(address));
    await setPaused(admin, false);
    await createCard(userA);
    assert.equal((await program.account.userCard.fetch(address)).owner.toBase58(), userA.publicKey.toBase58());
  });
});
