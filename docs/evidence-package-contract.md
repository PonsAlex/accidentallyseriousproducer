# Evidence package contract

<!-- GERADO POR `npm run contract:package`. Não edite à mão. -->

Versão do pacote: `1.0`

Este é o formato que o validador do ASP aceita. Ele é gerado a partir do próprio
validador: os valores permitidos e a lista de regras saem do código, e um teste
falha se este arquivo ficar para trás. Se algo aqui divergir do validador, o
validador está certo.

Entregar um pacote que viole qualquer regra da seção 10 **não é um erro de
julgamento**: é um pacote que não entra. O validador é a porteira.

## 1. Envelope do pacote

| campo | exigência |
| --- | --- |
| `packageVersion` | `"1.0"` |
| `scanDate` | data de calendário `YYYY-MM-DD`, real |
| `channelsMonitored` | lista de strings não vazia, com a fonte pelo nome |
| `candidatesAccepted` | inteiro ≥ 0, igual ao número de `records` |
| `candidatesRejected` | inteiro ≥ 0, igual ao número de itens de `rejectedSummary` |
| `rejectedSummary` | um motivo por item rejeitado, com a data da expiração |
| `records` | lista de registros |

Os números têm de fechar. Um cabeçalho que diz "3 rejeitados" e uma lista com 5
motivos derruba o pacote inteiro.

## 2. Forma de um registro

Obrigatórios em todo registro:

- `recordId`
- `productKind`
- `offerNature`
- `limitedBy`
- `primarySourceFound`
- `developer.name`
- `developer.developerOfficialUrl`
- `acquisitionUrl`
- `product.name`
- `product.category`
- `product.whatItIs`
- `offer`
- `evidence`
- `restrictions`
- `openQuestions`
- `missingFacts`
- `notApplicable`
- `toValidate`
- `pendingHumanDecision`

`recordId` é a identidade do produto entre pacotes e no catálogo. Use um slug
estável (`fabricante-produto`). Reenviar o mesmo `recordId` não duplica: mescla.
Reenviar com dados piores **reverte o que está publicado** — antes de entregar um
registro que já existe, rode `npm run intake:check`.

## 3. Valores permitidos

### Natureza da oferta

| campo | valores permitidos |
| --- | --- |
| `offerNature` | `permanent-free` · `limited-free` · `paid-promo` · `launch-price` · `update` · `not-an-offer` |

### Limite da oferta

| campo | valores permitidos |
| --- | --- |
| `limitedBy` | `time` · `quantity` · `catalog` · `none` |

### Papel da evidência

| campo | valores permitidos |
| --- | --- |
| `evidence[].role` | `primary` · `secondary` |

### Escopo do cupom

| campo | valores permitidos |
| --- | --- |
| `couponScope` | `vendor-wide` · `creator-affiliated` · `unknown` |

### Publicabilidade do cupom

| campo | valores permitidos |
| --- | --- |
| `couponPublishable` | `true` · `false` · `unknown` |

### Estado do texto

| campo | valores permitidos |
| --- | --- |
| `copyStatus` | `missing` · `draft` · `final` |

### Qualificação de gratuidade

| campo | valores permitidos |
| --- | --- |
| `freeQualification` | `Free` · `Free temporário` · `Requer compra` · `Requer código` · `Requer cadastro` · `Trial` · `Não é Free` · `Inconclusivo` |

`productCategory` tem de ser coerente com `productKind`: um `bundle` não é um
`plugin`. Essa divergência sozinha derrubou um pacote.

## 4. O contrato do texto

`copyStatus` é obrigatório em todo registro. Não é opcional e não tem default.

| `copyStatus` | `readerFacingCopy` |
| --- | --- |
| `missing` | ausente ou `null` — a extração produziu fatos e nenhum texto |
| `draft` | presente, com `title`, `summary`, `body` |
| `final` | presente, com `title`, `summary`, `body` |

Escrever texto e declarar `missing` derruba o pacote. Declarar `final` sem os
três campos também.

## 5. Coerência temporal

- `offerNature: "permanent-free"` → `endsAt` e `endsAtDate` nulos. Um grátis
  permanente não tem prazo final.
- `offerNature: "limited-free"` → `limitedBy` diferente de `none`.
- `limitedBy: "none"` → nenhum prazo.
- `limitedBy: "time"` → `endsAt` ou `endsAtDate` preenchido, **ou** declarado em
  `missingFacts`.
- `limitedBy: "quantity"` → sem prazo final; a escassez é de licenças.
- `dateOnly: true` só faz sentido quando existe um prazo.

## 6. Cupons

- `couponCode` presente → `couponScope` e `couponPublishable` obrigatórios.
- `couponScope: "creator-affiliated"` → `couponOwner` obrigatório.
- `couponPublishable: true` significa que o código **pode** ir ao leitor. Sem
  isso, ele não sai do pacote.
- O código nunca aparece em `readerFacingCopy`.

## 7. Evidência e fontes

- Pelo menos uma entrada em `evidence`.
- `url` completa em `https://`, sem marcador de redação, sem credencial.
- `primarySourceFound` tem de concordar com a evidência: dizendo `true` sem
  nenhuma fonte `primary`, o pacote não passa.

### Marcadores proibidos

Qualquer um destes derruba o registro:

- `\[suspicious link removed\]`
- `\[link removed\]`
- `\[removed\]`
- `\[redacted\]`

Se a ferramenta de coleta removeu uma URL, emita `null`. **Nunca** o marcador: ele
vira dado, e um dado falso é pior que a ausência dele.

## 8. Fatos ausentes vs. não aplicáveis

`missingFacts` e `notApplicable` só aceitam nomes desta lista. Um rótulo livre
como `"expiryDate"` não é lido por ninguém — é o mesmo que não declarar nada:

- `evidence`
- `sources`
- `readerFacingCopy`
- `copyStatus`
- `developerOfficialUrl`
- `acquisitionUrl`
- `primarySourceFound`
- `developer`
- `product`
- `productName`
- `promoPrice`
- `regularPrice`
- `regularPriceSource`
- `currency`
- `startsAt`
- `endsAt`
- `endsAtDate`
- `permanent`
- `offerNature`
- `limitedBy`
- `couponCode`
- `couponScope`
- `couponOwner`
- `couponPublishable`
- `freeQualification`
- `systemRequirements`
- `licenseTerms`

O mesmo fato não pode estar nas duas listas.

## 9. Autoridade editorial é do humano

O pacote **não** carrega veredito, status de publicação nem seleção. Nenhuma
destas chaves pode aparecer em lugar nenhum:

- `verdict`
- `verdictType`
- `editorialStatus`
- `editorialStage`
- `validation`
- `publication`
- `selection`
- `priority`
- `approved`
- `published`

`pendingHumanDecision` é obrigatório e vale `true`. O pacote descreve o que
encontrou; decidir o que publicar não é papel dele.

## 10. Toda regra que o validador emite

69 códigos: 60 erros (bloqueiam) e 9 avisos (não bloqueiam).

| código | severidade |
| --- | --- |
| `ACCEPTED_COUNT_MISMATCH` | erro |
| `CATEGORY_KIND_MISMATCH` | erro |
| `COPY_PRESENT_WHEN_MISSING` | erro |
| `COUPON_LEAKED_INTO_COPY` | erro |
| `COUPON_SCOPE_WITHOUT_CODE` | aviso |
| `CURRENCY_WITHOUT_PRICE` | erro |
| `DUPLICATE_QUESTION_AND_ACTION` | aviso |
| `DUPLICATE_RECORD_ID` | erro |
| `DUPLICATED_PACKAGE_VERSION` | aviso |
| `EDITORIAL_AUTHORITY_LEAK` | erro |
| `FABRICATED_TIMESTAMP` | erro |
| `FACT_IN_BOTH_LISTS` | erro |
| `FORBIDDEN_PRIVATE_FIELD` | erro |
| `INVALID_ACCEPTED_COUNT` | erro |
| `INVALID_CHANNELS` | erro |
| `INVALID_COPY_STATUS` | erro |
| `INVALID_COUPON` | erro |
| `INVALID_COUPON_PUBLISHABLE` | erro |
| `INVALID_COUPON_SCOPE` | erro |
| `INVALID_DATE` | erro |
| `INVALID_EVIDENCE_DATE` | erro |
| `INVALID_EVIDENCE_ENTRY` | erro |
| `INVALID_EVIDENCE_ROLE` | erro |
| `INVALID_FACT_LIST` | erro |
| `INVALID_FREE_QUALIFICATION` | erro |
| `INVALID_LIMITED_BY` | erro |
| `INVALID_LIST` | erro |
| `INVALID_OFFER_NATURE` | erro |
| `INVALID_PACKAGE` | erro |
| `INVALID_PRICE` | erro |
| `INVALID_PRODUCT_CATEGORY` | erro |
| `INVALID_PRODUCT_KIND` | erro |
| `INVALID_RECORD` | erro |
| `INVALID_RECORD_ID` | erro |
| `INVALID_RECORDS` | erro |
| `INVALID_REJECTED_COUNT` | erro |
| `INVALID_REJECTED_SUMMARY` | erro |
| `INVALID_SCAN_DATE` | erro |
| `INVALID_TIMESTAMP` | erro |
| `LIMITED_FREE_WITHOUT_LIMIT` | erro |
| `MEANINGLESS_DATE_ONLY` | aviso |
| `MISSING_COPY` | erro |
| `MISSING_COPY_FIELD` | erro |
| `MISSING_COUPON_OWNER` | erro |
| `MISSING_CURRENCY` | erro |
| `MISSING_DEVELOPER` | erro |
| `MISSING_EVIDENCE` | erro |
| `MISSING_EVIDENCE_FACT` | erro |
| `MISSING_EVIDENCE_NAME` | erro |
| `MISSING_HUMAN_DECISION_FLAG` | erro |
| `MISSING_OFFER` | erro |
| `MISSING_PRICE_SOURCE` | erro |
| `MISSING_PRIMARY_SOURCE_FLAG` | erro |
| `MISSING_PRODUCT` | erro |
| `MISSING_URL` | erro |
| `MISSING_WHAT_IT_IS` | aviso |
| `PERMANENT_FREE_WITH_LIMIT` | erro |
| `PERMANENT_WITH_END` | erro |
| `PRIMARY_SOURCE_MISMATCH` | erro |
| `PRIVATE_EMAIL_ADDRESS` | erro |
| `QUANTITY_LIMIT_WITH_END` | aviso |
| `REDACTED_URL` | erro |
| `REJECTED_SUMMARY_MISMATCH` | aviso |
| `TIME_LIMIT_WITHOUT_END` | erro |
| `UNDECLARED_COPY_GAP` | erro |
| `UNKNOWN_FACT_NAME` | aviso |
| `UNSAFE_URL` | erro |
| `UNSUPPORTED_PACKAGE_VERSION` | erro |
| `UNVERIFIED_REJECTED_COUNT` | aviso |

## 11. Antes de entregar

- [ ] `copyStatus` em **todo** registro
- [ ] nenhum marcador de redação em lugar nenhum
- [ ] `candidatesRejected` igual ao número de motivos em `rejectedSummary`
- [ ] `candidatesAccepted` igual ao número de `records`
- [ ] toda oferta `permanent-free` sem prazo final
- [ ] `dateOnly` só onde existe prazo
- [ ] `productCategory` coerente com `productKind`
- [ ] toda URL abre — testada, não suposta
- [ ] `npm run validate:input -- --input <pacote>` sem erros
- [ ] `npm run intake:check -- --input <pacote> --verify` revisado
