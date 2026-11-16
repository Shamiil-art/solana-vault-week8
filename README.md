# Simple Vault — практика Anchor

Неделя 8. Учебный контракт на Anchor 0.31.1 (Solana).

1. **Vault создан** — админ создаёт vault для SPL-токена.
2. **У каждого пользователя своя «карточка»** — пользователь создаёт личный аккаунт (PDA) внутри vault.

Контракт будет дорабатываться (депозиты, вывод и т.д.), поэтому сейчас он намеренно минимальный.

---

## Что делает контракт

```
initialize_vault    создаёт VaultState PDA, vault token account и share mint
create_user_card    создаёт UserCard PDA — личную карточку пользователя в vault
set_paused          админ приостанавливает или возобновляет создание карточек
close_user_card     владелец закрывает карточку и получает ренту
```

### `initialize_vault`

Вызывает админ (платит за аккаунты). Создаёт три аккаунта для выбранного `token_mint`:

| Аккаунт | Seeds | Что хранит |
|---|---|---|
| `vault_state` | `["vault", token_mint]` | admin, token_mint, адреса token account и share mint, bump и paused |
| `vault_token_account` | `["vault_tokens", token_mint]` | токен-аккаунт, владелец — vault PDA |
| `share_mint` | `["share_mint", token_mint]` | mint для shares (6 decimals), authority — vault PDA |

### `create_user_card`

Вызывает любой пользователь (платит за свою карточку). Создаёт `UserCard`:

| Поле | Описание |
|---|---|
| `vault` | к какому vault относится карточка |
| `owner` | владелец карточки |
| `bump` | bump PDA |
| `created_at` | время создания карточки по часам Solana (Unix timestamp) |

Seeds: `["user_card", vault_state, user]` — поэтому у одного пользователя в одном vault
может быть **только одна** карточка. Повторный вызов завершится ошибкой.

---

## Требования

| Инструмент | Версия | Установка |
|---|---|---|
| Rust | stable | https://rustup.rs |
| Solana CLI | 1.18+ | https://docs.solana.com/cli/install-solana-cli-tools |
| Anchor CLI | 0.31.1 | `cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.31.1 && avm use 0.31.1` |
| Node.js | 18+ | https://nodejs.org |
| Yarn | any | `npm i -g yarn` |

Rust-зависимости (`anchor-lang`, `anchor-spl` 0.31.1) подтянутся сами при `anchor build`.
JS-зависимости (`@coral-xyz/anchor`, `@solana/web3.js`, `@solana/spl-token`, `mocha`, `chai`, `typescript`) — через `yarn install`.

---

## Сборка и локальные тесты

```bash
yarn install --frozen-lockfile
anchor build
anchor keys sync
```

После синхронизации проверь, что `declare_id!` и оба раздела `programs.*` в
`Anchor.toml` совпадают с публичным ключом из
`solana-keygen pubkey target/deploy/simple_vault-keypair.json`.

Укажи путь к учебному кошельку и запусти тесты:

```bash
anchor test --provider.cluster localnet --provider.wallet "$ANCHOR_WALLET"
```

Тесты проверяют создание vault, отдельные карточки пользователей, отказ при
повторном создании, права админа на паузу, закрытие карточки с возвратом ренты
и возобновление создания карточек.

## Проверка в Devnet

Укажи в `ANCHOR_WALLET` путь к пополненному учебному кошельку. Если Solana CLI
уже настроен на Helius Devnet, загрузи адрес RPC из его конфигурации:

```bash
export ANCHOR_PROVIDER_URL="$(solana config get | awk '/^RPC URL: / { print $3; exit }')"
anchor deploy --provider.cluster "$ANCHOR_PROVIDER_URL" --provider.wallet "$ANCHOR_WALLET"
yarn ts-mocha --exit -p tsconfig.json -t 120000 'tests/**/*.ts'
```

## Структура проекта

```
vault-simple/
├── programs/simple_vault/src/lib.rs   # контракт
├── tests/vault.ts                     # тесты
├── Anchor.toml
├── Cargo.toml
└── package.json
```

---

## Частые ошибки

| Ошибка | Причина | Решение |
|---|---|---|
| `Insufficient funds` при деплое | мало SOL | пополни кошелёк на devnet |
| `AccountNotInitialized` в тестах | программа не задеплоена или другой ID | `anchor keys sync` → `anchor build` → `anchor deploy` |
| `already in use` при `create_user_card` | у пользователя уже есть карточка | это ожидаемо, карточка одна на пользователя |

---

## Выполненные задания для практики

1. Добавили в `UserCard` поле `created_at` (`Clock::get()?.unix_timestamp`).
2. Добавили инструкцию `close_user_card`, которая закрывает карточку и возвращает ренту владельцу.
3. Запретили создание карточек, если vault поставлен админом на паузу (флаг `paused` в `VaultState`).
