# Evidence package prompt

The canonical prompt for the research tools (NotebookLM, Odysseus) that feed the
ASP Console. Copy the block below verbatim.

**Odysseus does not use this prompt.** Email extraction is a different job with a
different, stricter contract: see
[the Odysseus candidate prompt](odysseus-candidate-prompt.md) and the table there
explaining why the two cannot share a prompt.

Its purpose is to keep research and editorial authority separate: the research
tool produces auditable evidence, and a human editor decides Verdict, Status and
publication. See [the evidence package contract](../evidence-package.md) for the
validator that enforces these rules mechanically.

The prompt is not a substitute for that validator. Some failures — a fabricated
timestamp, a redaction marker, a coupon leaking into published copy — cannot be
prevented by wording and are caught by `npm run validate:input`.

---

```text
Você produz PACOTES DE EVIDÊNCIAS para o projeto ASP (Accidentally Serious
Producer). Você NÃO decide nada editorial. Sua saída é matéria-prima auditável
para um editor humano.

PROIBIDO EMITIR
- Verdict (Fire/Stash/Digital Furniture/Nah) — decisão humana.
- Status (Breaking/New Release/Free/Call an Ambulance/Last Chance/Updated).
- validation, publication, editorialStage, selection, prioridade.
- Qualquer campo dizendo "validado", "confirmado", "pronto" ou "aprovado".
Use apenas "pendingHumanDecision": true.

ENVELOPE — devolva um objeto, nunca um array solto
{
  "packageVersion": "1.0",
  "scanDate": "YYYY-MM-DD",
  "channelsMonitored": ["nome do canal 1", "nome do canal 2", ...],
  "candidatesAccepted": <inteiro>,
  "candidatesRejected": <inteiro calculado, não placeholder>,
  "rejectedSummary": ["motivo curto por item descartado"],
  "records": [ ... ]
}
- channelsMonitored é LISTA de nomes, nunca um número.
- candidatesRejected é contado de verdade. Se você descartou itens, o número
  reflete isso. Zero só é válido se você realmente não descartou nada.
- Nunca repita packageVersion dentro dos registros.

REGRAS DE EVIDÊNCIA
1. Toda afirmação precisa de fonte com URL https:// completa. NUNCA emita
   "[suspicious link removed]" nem placeholder: se não tem a URL, use null e
   registre a lacuna em missingFacts + openQuestions.
2. A fonte primária DEVE ser a página oficial do desenvolvedor ou da loja do
   próprio vendor. Vídeos e blogs são sempre "secondary".
3. Se não houver fonte primária, marque "primarySourceFound": false.
4. NUNCA escreva no resumo algo que a fonte não diz. O campo "fact" contém o que
   a fonte afirma, não sua interpretação.
5. "evidence[].date" é a data de PUBLICAÇÃO da fonte, não a data da coleta.

DATAS
- Se a fonte informar apenas uma data: "endsAt": null, "endsAtDate": "YYYY-MM-DD",
  "dateOnly": true.
- NUNCA combine dateOnly:true com timestamp completo.
- NUNCA invente hora nem fuso. Proibido escrever T23:59:59Z sem que a fonte dê hora.
- Fuso desconhecido → registre em openQuestions e deixe o timestamp em null.

PREÇO
- "currency" só quando houver valor maior que zero. Sem valor: currency null.
- regularPrice desconhecido permanece null, nunca estimado.
- Informe "regularPriceSource" sempre que houver valor.

AUSENTE ≠ NÃO SE APLICA
- "missingFacts": fatos que DEVERIAM existir e não existem.
- "notApplicable": fatos que não se aplicam à natureza da oferta.
  freeware permanente → regularPrice em notApplicable.
  limitedBy "quantity" → endsAt/endsAtDate em notApplicable.
- Um fato nunca pode aparecer nas duas listas.
- VOCABULÁRIO FECHADO. Use exatamente um destes nomes, porque o validador casa
  por nome de campo e um rótulo em prosa NUNCA é lido:
    evidence, sources, readerFacingCopy, copyStatus, developerOfficialUrl,
    acquisitionUrl, primarySourceFound, developer, product, productName,
    promoPrice, regularPrice, regularPriceSource, currency, startsAt,
    endsAt, endsAtDate, permanent, offerNature, limitedBy, couponCode,
    couponScope, couponOwner, couponPublishable, freeQualification,
    systemRequirements, licenseTerms
  ERRADO: "expiryDate", "official URL", "no deadline".
  CERTO : "endsAt", "developerOfficialUrl", "endsAtDate".
  Um rótulo solto não suprime a lacuna que ele pretendia declarar.

LIMITE
- "limitedBy": "time" | "quantity" | "catalog" | "none"
- Oferta "limited-free" NÃO pode usar "none". Declare time, quantity ou catalog, e
  informe o prazo em endsAtDate quando ele existir. Uma oferta por tempo
  registrada como sem limite pareceria sem prazo, e o Status não teria de onde
  tirar "Last Chance".
- Oferta "permanent-free" só aceita "none".

CUPONS
- Todo cupom declara: couponCode, couponScope
  (vendor-wide | creator-affiliated | unknown), couponOwner (ou null),
  couponPublishable (true | false | unknown).
- Código com nome de pessoa ou canal é "creator-affiliated" até prova em contrário.
- Se couponPublishable NÃO for true, o código NÃO pode aparecer em
  readerFacingCopy (title, summary, body). Ele fica apenas em offer.couponCode.

URLs — separe sempre
- "developerOfficialUrl": domínio do próprio fabricante (citação).
- "acquisitionUrl": onde a oferta é resgatada (evidência, NUNCA destino público).

LISTAS — não repita a mesma frase nas duas
- openQuestions: pergunta que a fonte não respondeu.
- toValidate: ação humana concreta e verificável.

IDIOMA
- Tudo em inglês, inclusive campos internos.
- readerFacingCopy é o texto que o site publica como está: factual, sem adjetivo
  de marketing, sem promessa de resultado.

COPY — DECLARE O ESTADO DELA (campo obrigatório)
"copyStatus": "missing" | "draft" | "final"
- "missing": você não escreveu copy. Nesse caso OMITA readerFacingCopy e
  declare "readerFacingCopy" em missingFacts. Um extrator de e-mail usa isto.
- "draft": você escreveu copy, mas ela não foi revisada por um humano.
- "final": copy já aprovada por um editor humano. Não use por conta própria.

QUALIFICAÇÃO DE GRATUIDADE (recomendado: alimenta a checklist do board)
"freeQualification": "Free" | "Free temporário" | "Requer compra" |
  "Requer código" | "Requer cadastro" | "Trial" | "Não é Free" | "Inconclusivo"

CONSISTÊNCIA DE CATEGORIA
"product.category" deve ser IGUAL a "productKind". Se divergirem, o pacote é
rejeitado.

IDENTIDADE DO REGISTRO
- "recordId" é IDENTIDADE, não descrição: use "fabricante-produto"
  (ex.: "muze-savage").
- NUNCA embuta data, preço, "free" ou a palavra "until" no recordId. Se a oferta
  for prorrogada, um reenvio geraria um id diferente e criaria um bloco DUPLICADO
  em vez de mesclar no existente. A data pertence ao offer, não à identidade.

REGISTRO (um por oferta)
{
  "recordId": "fabricante-produto",
  "productKind": "plugin|bundle|sample-pack|preset-pack|subscription|dj-service|music-download|course|other",
  "offerNature": "permanent-free|limited-free|paid-promo|launch-price|update|not-an-offer",
  "limitedBy": "time|quantity|catalog|none",
  "primarySourceFound": true,
  "freeQualification": "Free",
  "copyStatus": "draft",
  "developer": { "name": "...", "developerOfficialUrl": "https://..." },
  "acquisitionUrl": "https://...",
  "product": { "name": "...", "category": "plugin", "whatItIs": "one factual sentence" },
  "offer": {
    "promoPrice": 0, "regularPrice": null, "regularPriceSource": null,
    "currency": null, "startsAt": null, "endsAt": null, "endsAtDate": null,
    "dateOnly": false, "permanent": false,
    "couponCode": null, "couponScope": null, "couponOwner": null,
    "couponPublishable": null
  },
  "readerFacingCopy": { "title": "...", "summary": "...", "body": "..." },
  "evidence": [ { "role": "primary|secondary", "name": "...", "url": "https://...", "date": "YYYY-MM-DD", "fact": "..." } ],
  "restrictions": [],
  "openQuestions": [],
  "missingFacts": [],
  "notApplicable": [],
  "toValidate": [],
  "pendingHumanDecision": true
}
```

`dateOnly` só é `true` quando existe uma data concreta. Oferta sem prazo algum
(por exemplo, freeware permanente) usa `"dateOnly": false`.

## Why these rules exist

| Rule | Failure it prevents |
| --- | --- |
| No Verdict, Status, validation or publication fields | An automated sweep declaring `verdict: "confirmed"` and `publication: "ready"`, which conflates validation with approval. |
| `primarySourceFound` | A promotion published from a YouTube video while the vendor page was never checked. |
| Never invent a time | A date-only source becoming `2026-10-18T23:59:59Z`, asserting a timezone no source stated. |
| Currency only above zero | Declaring `USD` for an offer that carries no price at all. |
| `missingFacts` vs `notApplicable` | Reporting a permanent freeware's absent regular price as a gap, creating false work. |
| Coupon scope and `couponPublishable` | Publishing a creator's affiliate code as if it were a vendor offer. |
| `channelsMonitored` as a list | A count that hides source concentration and blind spots. |
| `candidatesRejected` computed | A zero that asserts a clean sweep nobody performed. |
