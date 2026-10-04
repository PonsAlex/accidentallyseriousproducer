# CONSOLE.MD --- Padrão ASP Editorial Console

**Versão:** 1.0\
**Data:** 2026-10-02\
**Projeto:** Accidentally Serious Producer (ASP)

## Finalidade

Este documento ensina outras IAs, agentes de pesquisa e agentes de
código --- como NotebookLM, DeepSeek Harness, Copilot e equivalentes ---
a produzir conteúdo e alterações compatíveis com o novo **Editorial
Console** do ASP.

------------------------------------------------------------------------

## 1. Modelo editorial

O ASP usa o fluxo:

``` text
RADAR
  ↓
PREPARAÇÃO
  ↓
SELEÇÃO EDITORIAL
  ↓
BRANCH EDITORIAL
  ↓
PREVIEW / HUMAN REVIEW
  ↓
PUBLICATION GATE
```

O Console é a interface visual principal do trabalho editorial. O GitHub
Project permanece como histórico, auditoria e acompanhamento secundário; não é a fonte
primária do estado editorial local.

### Regra central

``` text
ANTES DE /advance
→ humano edita, verifica, seleciona e decide.

DEPOIS DE /advance
→ o estado está explicitamente preparado para futura automação.
```

Verdict, Status, checklists e validações **não autorizam avanço
automaticamente**.

------------------------------------------------------------------------

## 2. O Console não é um CMS

Não transformar o ASP em React, Next.js, CMS, banco de dados, SPA ou
novo backend sem necessidade.

Arquitetura de referência:

``` text
ASP
├── PUBLIC SITE
│   ├── HTML
│   ├── Web Components
│   └── dados públicos
│
└── CONSOLE
    ├── ContentBlock
    ├── estado editorial
    ├── edição visual
    ├── preview real
    ├── persistência local
    ├── import/export
    └── /advance
          ↓
      FUTURA AUTOMAÇÃO
```

O princípio é **mudança mínima e verificável**.

------------------------------------------------------------------------

## 3. Componentes reais, não mocks

O Console deve reutilizar componentes que já existem no ASP.

Exemplos:

-   hero da homepage;
-   featured article;
-   product review;
-   deal;
-   `<affiliate-offer>`;
-   projeto do ASP Lab.

Não criar `fake-card`, `mock-article`, `console-card` ou equivalentes
apenas para representar o site.

Fluxo correto:

``` text
SITE PÚBLICO
    ↓
componente existente
    ↓
Console reutiliza a representação real
```

------------------------------------------------------------------------

## 4. ContentBlock

O elemento central é:

``` js
{
  id,
  type,
  content,
  section,
  position,
  status,          // ciclo técnico do registro: draft/review/approved/published/archived
  metadata         // estado editorial: stage, Verdict, Status, evidence, advance etc.
}
```

Tipos de referência:

``` text
hero
article
product-review
deal
project
```

Se um novo tipo for necessário, primeiro confirme que existe um
componente real correspondente.

### Exemplo

``` json
{
  "id": "radar-example-review",
  "type": "product-review",
  "content": {
    "title": "Exemplo",
    "body": "Conteúdo editorial...",
    "href": "/articles/exemplo.html"
  },
  "section": "articles",
  "position": 10,
  "status": "review",
  "metadata": {
    "enabled": true,
    "editorialStage": "RADAR",
    "sources": [],
    "evidence": {},
    "selection": "",
    "verdict": "",
    "editorialStatus": "",
    "validation": {},
    "publication": {
      "state": "unpublished",
      "approvedAt": null,
      "publishedAt": null
    },
    "advance": {
      "selected": false,
      "ready": false,
      "requestedAt": null
    }
  }
}
```

------------------------------------------------------------------------

## 5. Separar conteúdo de metadados

### Conteúdo

``` text
title
body
eyebrow
image
href
price
date
product
promotion
```

### Metadados editoriais

``` text
editorialStage
sources
evidence
selection
verdict
editorialStatus
validation
publication
advance
enabled
```

Não misturar o estado editorial dentro do texto visual quando isso puder
ser evitado.

------------------------------------------------------------------------

## 6. Seções

Seções de referência:

``` text
home
articles
deals
lab
```

Não aumentar a taxonomia apenas para facilitar uma implementação
específica.

------------------------------------------------------------------------

## 7. Verdict e Status

Preservar a taxonomia existente.

### Verdict

``` text
Fire
Stash
Digital Furniture
Nah
```

### Status

``` text
Breaking
New Release
Free
Call an Ambulance
Last Chance
Updated
```

Não inventar novas categorias ou substituir as existentes sem mudança
explícita da especificação editorial.

------------------------------------------------------------------------

## 8. Editorial Stage

Os estágios são:

``` text
RADAR
PREPARAÇÃO
SELEÇÃO EDITORIAL
BRANCH EDITORIAL
PREVIEW / HUMAN REVIEW
PUBLICATION GATE
```

Não inferir que um item pode avançar porque:

-   preço foi validado;
-   fonte foi confirmada;
-   Verdict existe;
-   Status existe;
-   todos os checkboxes estão marcados;
-   preview parece pronto.

A decisão de avanço pertence ao humano.

------------------------------------------------------------------------

## 9. /advance

`/advance` é uma ação explícita.

Sem confirmação:

``` text
/advance → bloqueado
```

Com confirmação humana explícita:

``` text
RADAR
  ↓
/advance
  ↓
PREPARAÇÃO
```

O avanço deve registrar, quando aplicável:

``` text
fromStage
toStage
requestedAt
selected
ready
```

`/advance` não deve publicar automaticamente nem disparar JEV/AI Gateway
na Fase 2.

------------------------------------------------------------------------

## 10. Alterações após /advance

Uma aprovação vale para o estado aprovado.

Se o componente for alterado depois do avanço --- por exemplo:

``` text
editar conteúdo
mover
reordenar
desativar
alterar estado editorial
```

a prontidão deve ser invalidada:

``` text
advance.ready = false
advance.selected = false
```

O histórico de `requestedAt` pode ser preservado.

------------------------------------------------------------------------

## 11. Persistência local

A implementação atual usa `localStorage`.

``` text
Console
  ↓
estado editorial
  ↓
localStorage
```

Isso significa que o Console atual:

-   não altera automaticamente o HTML público;
-   não publica;
-   não faz deploy;
-   não altera automaticamente o GitHub Project;
-   não chama JEV;
-   não chama AI Gateway.

É um workspace editorial local.

------------------------------------------------------------------------

## 12. Import / Export

O Console deve oferecer:

``` text
Export state
Import state
```

O JSON exportado deve preservar o estado necessário para continuar o
trabalho.

O JSON importado deve ser validado antes de ser aceito.

Nunca confiar cegamente em estado importado.

------------------------------------------------------------------------

## 13. Schema versionado

O estado editorial deve possuir versão.

Exemplo atual:

``` js
CONTENT_BLOCK_SCHEMA_VERSION = 2;
```

Mudanças estruturais devem seguir:

``` text
schema antigo
    ↓
migration
    ↓
schema atual
    ↓
validation
```

Não apagar silenciosamente dados editoriais durante uma migration.

Preservar especialmente:

``` text
Verdict
Status
editorialStage
sources
evidence
validation
publication
advance
```

------------------------------------------------------------------------

## 14. Validação

Validar pelo menos:

### IDs

``` text
id obrigatório
IDs únicos
```

### Tipo

``` text
type permitido
```

### Seção

``` text
section permitida
```

### Posição

``` text
inteiro não negativo
```

### Conteúdo

``` text
content é objeto
```

### Links

Permitir caminhos locais e URLs HTTPS válidas.

Rejeitar esquemas perigosos, por exemplo:

``` text
javascript:
```

e URLs com credenciais embutidas.

### Datas

Validar datas antes de aceitar o estado.

### Metadados

Garantir que a estrutura editorial esperada exista.

------------------------------------------------------------------------

## 15. Carregamento dos componentes públicos

O Console pode buscar páginas públicas para obter a estrutura dos
componentes.

Na implementação de referência:

``` text
/index.html
/articles/radar-setembro-22.html
/lab.html
```

Modelo:

``` text
fetch página
      ↓
parse HTML
      ↓
localizar componente
      ↓
clonar/reutilizar estrutura
      ↓
ContentBlock
      ↓
preview
```

Não duplicar manualmente o HTML inteiro quando a estrutura pública já
pode ser reutilizada.

------------------------------------------------------------------------

## 16. Diagnóstico do bootstrap

O Console não deve permanecer silenciosamente em:

``` text
Loading editorial content…
```

Se uma fonte falhar, mostrar erro contextual.

Exemplo:

``` text
Could not load public component templates from /index.html:
network unavailable
```

A página problemática deve aparecer na mensagem.

Ao diagnosticar:

1.  testar `/console/`;
2.  testar cada fonte pública;
3.  abrir DevTools;
4.  verificar Network;
5.  verificar Console;
6.  identificar a camada que falhou;
7.  corrigir somente essa camada.

Não substituir o sistema por mocks para esconder uma falha.

------------------------------------------------------------------------

## 17. Interface mínima

O editor deve conseguir:

``` text
criar um ContentBlock em branco de tipo permitido
selecionar
editar
mover/reordenar
ativar/desativar
visualizar
editar estado editorial
exportar
importar
confirmar /advance
```

O botão **+ Add Block** permite criar somente `hero`, `article`,
`product-review`, `deal` e `project`, usando exclusivamente a seção compatível definida pelo Console (`hero/article → home`, `product-review → articles`, `deal → deals`, `project → lab`).
O bloco reutiliza o template público do seu tipo e é salvo como rascunho local
após a criação; cancelar não altera o estado. Blocos novos começam habilitados
em `RADAR`, sem Verdict, Status editorial, aprovação, publicação ou avanço
confirmado. Um `deal` começa sem promoção e permanece incompleto até que uma
promoção pública aprovada existente seja selecionada. Não criar preços, URLs,
promoções ou evidências para preencher esse bloco.

Exemplo:

``` text
Editorial stage: RADAR
Advance readiness: not confirmed

[ Confirm & /advance → PREPARAÇÃO ]

[ Deactivate component ]
```

Isso deixa claro:

``` text
stage ≠ approval
```

------------------------------------------------------------------------

## 18. O preview deve parecer o ASP

O Console não precisa duplicar toda a página pública.

Ele deve representar corretamente os componentes que o editor manipula.

Priorizar:

``` text
estrutura
tipografia
hierarquia
conteúdo
componentes
links
estado visual
```

Evitar uma interface administrativa genérica que impeça a avaliação do
resultado editorial.

------------------------------------------------------------------------

## 19. Fluxo para IAs de pesquisa

Uma IA como NotebookLM deve ser usada principalmente para:

``` text
fontes
  ↓
síntese
  ↓
evidências
  ↓
candidato editorial
```

Separar:

``` text
FATO DA FONTE
INTERPRETAÇÃO
INFORMAÇÃO AUSENTE
PONTO A VALIDAR
```

Não transformar inferência em fato editorial.

### Formato recomendado

``` text
SOURCE
URL:
ORIGIN:
DATE:

EVIDENCE
PRODUCT:
PRICE:
OFFER:
DATES:
TERMS:

EDITORIAL CANDIDATE
TYPE:
TITLE:
SUMMARY:

OPEN QUESTIONS
...

HUMAN DECISION
PENDING
```

------------------------------------------------------------------------

## 20. Fluxo para IAs de código

Para agentes como DeepSeek Harness ou Copilot:

``` text
1. ler README
2. ler CONSOLE.MD
3. localizar componentes existentes
4. localizar ContentBlock/state
5. localizar testes
6. entender o fluxo atual
7. fazer a menor alteração necessária
8. adicionar teste de regressão
9. executar testes/lint/build/validação
10. apresentar o resultado
```

Não começar por uma arquitetura nova.

### Regra

Se o pedido for corrigir carregamento:

``` text
diagnóstico
→ correção cirúrgica
→ teste
→ validação
```

e não:

``` text
reescrever o Console
→ migrar framework
→ criar API
→ criar banco
```

------------------------------------------------------------------------

## 21. Contrato de saída para outras IAs

Quando uma IA preparar material para o Console, preferir:

``` text
CONTENT BLOCK
- ID
- TYPE
- SECTION
- POSITION
- CONTENT
- STATUS

EDITORIAL METADATA
- STAGE
- SOURCES
- EVIDENCE
- SELECTION
- VERDICT
- EDITORIAL STATUS
- VALIDATION
- PUBLICATION
- ADVANCE

HUMAN REVIEW
- pontos a confirmar
- dúvidas
- informação ausente
- riscos editoriais
```

A saída deve ser diretamente revisável pelo editor.

------------------------------------------------------------------------

## 22. Exemplo de candidato editorial

``` json
{
  "id": "deal-example-2026",
  "type": "deal",
  "section": "deals",
  "position": 10,
  "status": "review",
  "content": {
    "promotionId": "promo-example-2026"
  },
  "metadata": {
    "enabled": true,
    "editorialStage": "RADAR",
    "sources": [
      "https://example.com/official-offer"
    ],
    "evidence": {
      "sourceConfirmed": true,
      "productConfirmed": true,
      "priceConfirmed": true,
      "datesConfirmed": true,
      "termsConfirmed": true,
      "sufficient": true
    },
    "selection": "",
    "verdict": "",
    "editorialStatus": "Last Chance",
    "validation": {
      "claims": false,
      "price": true,
      "dates": true,
      "terms": true,
      "status": false,
      "recut": false,
      "verdict": false,
      "links": true,
      "previewApproved": false
    },
    "publication": {
      "state": "unpublished",
      "approvedAt": null,
      "publishedAt": null
    },
    "advance": {
      "selected": false,
      "ready": false,
      "requestedAt": null
    }
  }
}
```

Observe:

``` text
fonte confirmada ≠ publicação autorizada
```

------------------------------------------------------------------------

## 23. O que uma IA NÃO deve fazer

Não:

-   criar CMS;
-   criar banco sem necessidade;
-   migrar para React/Next sem necessidade;
-   criar componentes falsos;
-   inventar fontes;
-   inventar preços;
-   inventar datas;
-   transformar promoção não validada em oferta pública;
-   apagar metadados;
-   apagar histórico em migrations;
-   inferir aprovação;
-   avançar automaticamente;
-   usar Verdict/Status como autorização;
-   publicar diretamente;
-   disparar automação futura na Fase 2;
-   tratar o GitHub Kanban como substituto do Console.

------------------------------------------------------------------------

## 24. Testes de aceite

Uma implementação deve verificar:

``` text
[ ] /console abre
[ ] fontes públicas carregam
[ ] componentes reais aparecem
[ ] conteúdo pode ser editado
[ ] edição sobrevive ao reload
[ ] export funciona
[ ] import funciona
[ ] componentes podem ser movidos
[ ] componentes podem ser reordenados
[ ] componentes podem ser ativados/desativados
[ ] Verdict permanece separado do avanço
[ ] Status permanece separado do avanço
[ ] /advance exige confirmação humana
[ ] /advance registra a transição
[ ] alteração posterior invalida readiness
[ ] + Add Block cria um único draft válido e persistido
[ ] Cancel no formulário de criação não altera o estado
[ ] deal novo não inventa promoção, preço, URL ou evidência
[ ] estado inválido é rejeitado
[ ] links perigosos são rejeitados
[ ] migration preserva dados editoriais
[ ] testes automatizados passam
[ ] lint passa
[ ] build passa
[ ] validação de dados passa
```

------------------------------------------------------------------------

## 25. Arquitetura futura

A direção planejada é:

``` text
RADAR
  ↓
ASP CONSOLE
  ↓
HUMAN REVIEW
  ↓
/advance
  ↓
JEV
  ↓
Vercel AI Gateway
  ↓
VALIDATION
  ↓
PUBLICATION
```

Essa automação é futura.

O Console atual deve somente preparar um estado editorial explícito e
confiável.

------------------------------------------------------------------------

## 26. Regra de ouro

### O Console não decide o que é bom.

Ele organiza, apresenta e registra o estado editorial.

### A IA não decide o que deve ser publicado.

Ela pode:

-   pesquisar;
-   sintetizar;
-   encontrar evidências;
-   preparar conteúdo;
-   sugerir estrutura;
-   detectar inconsistências;
-   validar dados.

A autoridade editorial permanece humana.

### `/advance` é a fronteira.

``` text
ANTES
human-in-the-loop

DEPOIS
automation-ready
```

------------------------------------------------------------------------

## 27. Resumo operacional

Se você é uma IA trabalhando no ASP:

``` text
1. Leia o estado atual antes de alterar arquitetura.
2. Use componentes ASP existentes.
3. Modele o conteúdo como ContentBlock.
4. Separe conteúdo de metadados.
5. Preserve Verdict e Status.
6. Não invente evidências.
7. Não trate validação como aprovação.
8. Não avance automaticamente.
9. /advance exige confirmação humana explícita.
10. Alterações posteriores podem invalidar readiness.
11. Use persistência local no Console atual.
12. Preserve schema e faça migrations.
13. Teste bootstrap, componentes, persistência, import/export,
    organização e /advance.
14. Prefira mudanças pequenas e verificáveis.
15. Não introduza CMS, DB, React, Next ou automação sem necessidade.
16. GitHub Project = histórico/auditoria.
17. Console = interface editorial visual.
```

## Frase curta para agentes

> **Produza para o ASP como ContentBlocks que reutilizam componentes
> reais do site, mantenha conteúdo separado de metadados editoriais,
> preserve evidências/Verdict/Status, nunca infira aprovação, mantenha o
> humano como autoridade antes de `/advance` e trate o estado após
> `/advance` como pronto para futura automação --- sem criar CMS, banco,
> framework ou publicação automática desnecessários.**


Prompt

# ASP → PROMPT MESTRE: EDITORIAL CONSOLE

Voc→ est→ trabalhando no projeto **Accidentally Serious Producer (ASP)**.

Sua tarefa → produzir conte→do, dados, alterações de código ou candidatos editoriais **compat→veis com o padr→o ASP Editorial Console**.

Este prompt → o contrato operacional. Siga-o antes de produzir qualquer resultado.

---

## 1. MODELO EDITORIAL

O fluxo do ASP →:

```text
RADAR
  ?
PREPARAÇÃO
  ?
SELE→→O EDITORIAL
  ?
BRANCH EDITORIAL
  ?
PREVIEW / HUMAN REVIEW
  ?
PUBLICATION GATE
```

O **Editorial Console** → a interface visual principal para o trabalho editorial.

O GitHub Project → secund→rio e serve para:

* hist→rico;
* auditoria;
* acompanhamento;
* sincronização;
* registro do processo.

### REGRA CENTRAL

```text
ANTES DE /advance
? o humano edita, verifica, seleciona e decide.

DEPOIS DE /advance
? o estado est→ explicitamente preparado para futura automação.
```

Nunca confunda:

```text
validação ? aprovação
Verd ict ? aprovação
Status ? aprovação
stage ? aprovação
```

---

# 2. N→O TRANSFORME O ASP EM UM CMS

Preserve a arquitetura existente.

Não introduza sem necessidade:

* React;
* Next.js;
* CMS;
* banco de dados;
* novo backend;
* SPA;
* framework;
* sistema administrativo separado.

Prefira a arquitetura existente:

```text
HTML
CSS
ES Modules
Web Components
JSON
localStorage
Node tests
```

Fa→a sempre a menor mudan→a necessária.

---

# 3. USE COMPONENTES REAIS

O Console deve reutilizar componentes que j→ existem no ASP.

Exemplos:

```text
hero
featured article
product review
deal
affiliate-offer
ASP Lab project
```

Não crie:

```text
fake-card
mock-article
console-card
placeholder-component
```

apenas para representar componentes reais.

O fluxo correto →:

```text
SITE P→BLICO
    ?
COMPONENTE EXISTENTE
    ?
CONSOLE REUTILIZA O COMPONENTE
```

O preview deve representar o produto real, n→o uma maquete paralela.

---

# 4. MODELE O CONTE→DO COMO ContentBlock

Use o conceito:

```js
{
  id,
  type,
  content,
  section,
  position,
  status,
  metadata
}
```

Tipos de refer→ncia:

```text
hero
article
product-review
deal
project
```

S→ crie outro tipo se existir uma necessidade real e um componente correspondente.

---

# 5. SEPARE CONTE→DO DE METADADOS

## CONTE→DO

```text
title
body
eyebrow
image
href
price
date
product
promotion
```

## METADADOS EDITORIAIS

```text
editorialStage
sources
evidence
selection
verdict
editorialStatus
validation
publication
advance
enabled
```

Não misture estado editorial com texto visual quando isso puder ser evitado.

---

# 6. SE→→ES

As se→→es de refer→ncia s→o:

```text
home
articles
deals
lab
```

Não crie novas se→→es apenas para simplificar uma implementação.

---

# 7. PRESERVE VERDICT E STATUS

Use exatamente as taxonomias existentes.

## VERDICT

```text
Fire
Stash
Digital Furniture
Nah
```

## STATUS

```text
Breaking
New Release
Free
Call an Ambulance
Last Chance
Updated
```

Não invente sin→nimos ou novas categorias automaticamente.

---

# 8. PRESERVE OS EST→GIOS

Use:

```text
RADAR
PREPARAÇÃO
SELE→→O EDITORIAL
BRANCH EDITORIAL
PREVIEW / HUMAN REVIEW
PUBLICATION GATE
```

Nunca avance automaticamente porque um item parece pronto.

Mesmo que:

* preço esteja validado;
* fonte esteja confirmada;
* todos os checks estejam completos;
* Verdict esteja definido;
* Status esteja definido;
* preview esteja correto.

A decis→o final antes de `/advance` pertence ao humano.

---

# 9. REGRA DE /advance

`/advance` exige confirmação humana explícita.

Sem confirmação:

```text
/advance ? BLOQUEADO
```

Com confirmação:

```text
RADAR
  ?
/advance
  ?
PREPARAÇÃO
```

Registre, quando aplic→vel:

```text
fromStage
toStage
requestedAt
selected
ready
```

Não transforme `/advance` em publicação autom→tica.

Não dispare JEV ou AI Gateway na implementação atual apenas porque `/advance` existe.

---

# 10. INVALIDAÇÃO AP→S /advance

A aprovação corresponde ao estado aprovado.

Se o conte→do mudar depois:

```text
editar
mover
reordenar
desativar
alterar estado editorial
```

invalide a prontid→o:

```text
advance.ready = false
advance.selected = false
```

O hist→rico de `requestedAt` pode permanecer.

Nunca trate `/advance` como autorização permanente.

---

# 11. PERSISTÊNCIA

O Console atual usa persist→ncia local:

```text
Console
  ?
localStorage
```

Não assuma que o Console:

* publica;
* faz deploy;
* modifica HTML público;
* modifica GitHub automaticamente;
* chama JEV;
* chama AI Gateway.

O Console atual → um workspace editorial local.

---

# 12. IMPORT / EXPORT

O Console deve preservar:

```text
Export state
Import state
```

O estado exportado deve conter informação suficiente para continuar o trabalho.

Estado importado deve ser validado.

Nunca aceite JSON externo cegamente.

---

# 13. SCHEMA

O estado editorial → versionado.

Exemplo:

```js
CONTENT_BLOCK_SCHEMA_VERSION = 2;
```

Ao mudar a estrutura:

```text
schema antigo
    ?
migration
    ?
schema atual
    ?
validation
```

Não destrua dados editoriais durante migrations.

Preserve:

```text
Verd ict
Status
editorialStage
sources
evidence
validation
publication
advance
```

---

# 14. VALIDAÇÃO

Valide:

### IDs

```text
id obrigat→rio
IDs →nicos
```

### Tipo

```text
type permitido
```

### Se→→o

```text
section permitida
```

### Posi→→o

```text
inteiro n→o negativo
```

### Conte→do

```text
content → objeto
```

### Links

Aceite:

```text
/local/path
https://...
```

Rejeite esquemas perigosos como:

```text
javascript:
```

e URLs contendo credenciais.

### Datas

Valide datas.

### Metadados

Valide a estrutura editorial esperada.

---

# 15. COMPONENTES PÚBLICOS

O Console pode carregar páginas p→blicas para obter componentes reais.

Fontes de refer→ncia:

```text
/index.html
/articles/radar-setembro-22.html
/lab.html
```

Fluxo:

```text
fetch
  ?
parse HTML
  ?
localizar componente
  ?
reutilizar estrutura
  ?
ContentBlock
  ?
preview
```

Não duplique manualmente componentes que j→ podem ser obtidos das páginas p→blicas.

---

# 16. DIAGN→STICO DO BOOTSTRAP

Nunca deixe o Console preso silenciosamente em:

```text
Loading editorial content→
```

Se houver falha, mostre erro contextual.

Exemplo:

```text
Could not load public component templates from /index.html:
network unavailable
```

Ao diagnosticar:

```text
1. testar /console/
2. testar as fontes p→blicas
3. abrir DevTools
4. verificar Network
5. verificar Console
6. identificar a camada que falhou
7. corrigir somente essa camada
```

Não esconda um problema substituindo componentes reais por mocks.

---

# 17. INTERFACE DO CONSOLE

O editor deve conseguir:

```text
selecionar
editar
mover
reordenar
ativar
desativar
visualizar
editar estado editorial
exportar
importar
confirmar /advance
```

A interface deve deixar explícito:

```text
Editorial stage: RADAR
Advance readiness: not confirmed
```

E apresentar ação explícita:

```text
Confirm & /advance ? PREPARAÇÃO
```

O objetivo → deixar evidente:

```text
stage ? approval
```

---

# 18. PREVIEW

O preview deve usar a identidade e os componentes reais do ASP.

Priorize:

```text
estrutura
tipografia
hierarquia
conte→do
componentes
links
estado visual
```

Não construa uma interface administrativa que esconda o resultado editorial real.

---

# 19. NOTEBOOKLM / IAs DE PESQUISA

Se voc→ estiver produzindo pesquisa editorial:

```text
fontes
  ?
síntese
  ?
evidências
  ?
candidato editorial
```

Separe claramente:

```text
FATO DA FONTE
INTERPRETAÇÃO
INFORMAÇÃO AUSENTE
PONTO A VALIDAR
```

Nunca transforme uma infer→ncia em fato.

Use preferencialmente:

```text
SOURCE
URL:
ORIGIN:
DATE:

EVIDENCE
PRODUCT:
PRICE:
OFFER:
DATES:
TERMS:

EDITORIAL CANDIDATE
TYPE:
TITLE:
SUMMARY:

OPEN QUESTIONS
...

HUMAN DECISION
PENDING
```

---

# 20. DEEPSEEK HARNESS / COPILOT / AGENTES DE C→DIGO

Antes de alterar o projeto:

```text
1. ler README
2. ler CONSOLE.MD
3. localizar componentes existentes
4. localizar ContentBlock/state
5. localizar testes
6. entender o fluxo atual
7. fazer a menor alteração necessária
8. adicionar teste de regress→o
9. executar testes
10. executar lint
11. executar build
12. executar valida→→es de dados
13. apresentar o resultado
```

Não reescreva a arquitetura sem necessidade.

Para um bug de carregamento:

```text
diagn→stico
? corre→→o cir→rgica
? teste
? validação
```

Não fa→a:

```text
reescrever Console
migrar framework
criar API
criar banco
```

---

# 21. CONTRATO DE SA→DA

Quando produzir material para o ASP Console, organize a sa→da como:

```text
CONTENT BLOCK
- ID
- TYPE
- SECTION
- POSITION
- CONTENT
- STATUS

EDITORIAL METADATA
- STAGE
- SOURCES
- EVIDENCE
- SELECTION
- VERDICT
- EDITORIAL STATUS
- VALIDATION
- PUBLICATION
- ADVANCE

HUMAN REVIEW
- pontos a confirmar
- dúvidas
- informação ausente
- riscos editoriais
```

---

# 22. EXEMPLO DE CANDIDATO

```json
{
  "id": "deal-example-2026",
  "type": "deal",
  "section": "deals",
  "position": 10,
  "status": "review",
  "content": {
    "promotionId": "promo-example-2026"
  },
  "metadata": {
    "enabled": true,
    "editorialStage": "RADAR",
    "sources": [
      "https://example.com/official-offer"
    ],
    "evidence": {
      "sourceConfirmed": true,
      "productConfirmed": true,
      "priceConfirmed": true,
      "datesConfirmed": true,
      "termsConfirmed": true,
      "sufficient": true
    },
    "selection": "",
    "verdict": "",
    "editorialStatus": "Last Chance",
    "validation": {
      "claims": false,
      "price": true,
      "dates": true,
      "terms": true,
      "status": false,
      "recut": false,
      "verdict": false,
      "links": true,
      "previewApproved": false
    },
    "publication": {
      "state": "unpublished",
      "approvedAt": null,
      "publishedAt": null
    },
    "advance": {
      "selected": false,
      "ready": false,
      "requestedAt": null
    }
  }
}
```

Lembre:

```text
fonte confirmada ? publicação autorizada
```

---

# 23. PROIBIÇÕES

Não:

* crie CMS;
* crie banco sem necessidade;
* migre para React/Next sem necessidade;
* crie componentes falsos;
* invente fontes;
* invente preços;
* invente datas;
* transforme promoção n→o validada em oferta p→blica;
* apague metadados;
* destrua hist→rico em migrations;
* infira aprovação;
* avance automaticamente;
* use Verdict como autorização;
* use Status como autorização;
* publique diretamente;
* dispare automação futura na Fase 2;
* trate GitHub Kanban como substituto do Console.

---

# 24. TESTE DE ACEITE

Verifique:

```text
[ ] /console abre
[ ] fontes p→blicas carregam
[ ] componentes reais aparecem
[ ] conte→do pode ser editado
[ ] edi→→o sobrevive ao reload
[ ] export funciona
[ ] import funciona
[ ] componentes podem ser movidos
[ ] componentes podem ser reordenados
[ ] componentes podem ser ativados/desativados
[ ] Verdict permanece separado do avan→o
[ ] Status permanece separado do avan→o
[ ] /advance exige confirmação humana
[ ] /advance registra transição
[ ] alteração posterior invalida readiness
[ ] estado inv→lido → rejeitado
[ ] links perigosos s→o rejeitados
[ ] migration preserva dados editoriais
[ ] testes passam
[ ] lint passa
[ ] build passa
[ ] validação de dados passa
```

---

# 25. AUTOMAÇÃO FUTURA

A dire→→o planejada →:

```text
RADAR
  ?
ASP CONSOLE
  ?
HUMAN REVIEW
  ?
/advance
  ?
JEV
  ?
Vercel AI Gateway
  ?
VALIDATION
  ?
PUBLICATION
```

Essa automação → futura.

Não implemente essa cadeia dentro da Fase 2 sem instru→→o explícita.

---

# 26. REGRA DE OURO

O Console n→o decide o que → bom.

Ele:

```text
organiza
apresenta
permite editar
registra estado
```

A IA pode:

```text
pesquisar
sintetizar
encontrar evidências
preparar conte→do
sugerir estrutura
detectar inconsist→ncias
validar dados
```

Mas a autoridade editorial permanece humana.

`/advance` → a fronteira:

```text
ANTES
human-in-the-loop

DEPOIS
automation-ready
```

---

# 27. INSTRU→→O FINAL

Sempre que trabalhar no ASP:

```text
Leia o estado atual.
Leia CONSOLE.MD quando dispon→vel.
Use componentes reais.
Modele como ContentBlock.
Separe conte→do de metadados.
Preserve Verdict, Status, fontes e evidências.
Não invente fatos.
Não trate validação como aprovação.
Não avance automaticamente.
Exija confirmação humana para /advance.
Invalide readiness ap→s mudan→as.
Preserve schema e hist→rico.
Fa→a mudan→as pequenas.
Teste tudo.
Não introduza infraestrutura desnecessária.
```

## RESUMO EM UMA FRASE

> **Produza para o ASP como ContentBlocks que reutilizam componentes reais do site, mantenha conte→do separado de metadados editoriais, preserve evidências/Verdict/Status, nunca infira aprovação, mantenha o humano como autoridade antes de `/advance` e trate o estado ap→s `/advance` como pronto para futura automação → sem criar CMS, banco, framework ou publicação autom→tica desnecessários.**

# ASP → EDITORIAL CONSOLE | PROMPT MESTRE

Voc→ trabalha no projeto **Accidentally Serious Producer (ASP)**. Produza conte→do, dados ou código compat→veis com o padr→o Editorial Console. Este prompt → o contrato operacional.

## FLUXO

`RADAR ? PREPARAÇÃO ? SELE→→O EDITORIAL ? BRANCH EDITORIAL ? PREVIEW / HUMAN REVIEW ? PUBLICATION GATE`

O Console → a interface editorial visual principal. GitHub Project = hist→rico/auditoria/acompanhamento/sincronização.

**REGRA CENTRAL:** antes de `/advance`, o humano edita, verifica, seleciona e decide. Depois de `/advance`, o estado est→ explicitamente preparado para futura automação. `validação ? aprovação`; `Verdict ? aprovação`; `Status ? aprovação`; `stage ? aprovação`.

## ARQUITETURA

Não transforme o ASP em CMS, React, Next.js, SPA, banco, backend ou framework sem necessidade. Preserve HTML, CSS, ES Modules, Web Components, JSON, localStorage e testes Node. Fa→a a menor mudan→a necessária.

## COMPONENTES REAIS

O Console deve reutilizar componentes existentes do ASP: hero, featured article, product review, deal, `<affiliate-offer>`, ASP Lab project etc. Não crie `fake-card`, `mock-article`, `console-card` ou placeholders para representar componentes reais. O preview deve representar o produto real.

## CONTENTBLOCK

Modele conte→do como:

```js
{ id, type, content, section, position, status, metadata }
```

Tipos de refer→ncia: `hero`, `article`, `product-review`, `deal`, `project`. S→ crie outro tipo se existir necessidade real e componente correspondente.

## SEPARAÇÃO

**CONTENT:** `title`, `body`, `eyebrow`, `image`, `href`, `price`, `date`, `product`, `promotion`.
**RECORD STATUS:** `status` é o estado técnico do registro (`draft`, `review`, `approved`, `published`, `archived`).
**EDITORIAL STATUS:** `metadata.editorialStatus` usa somente a taxonomia editorial definida pelo ASP.
**METADATA:** `editorialStage`, `sources`, `evidence`, `selection`, `verdict`, `editorialStatus`, `validation`, `publication`, `advance`, `enabled`.

## SE→→ES

Refer→ncia: `home`, `articles`, `deals`, `lab`. Não crie novas se→→es apenas para facilitar implementação.

## TAXONOMIAS

**Verdict:** `Fire`, `Stash`, `Digital Furniture`, `Nah`.
**Status:** `Breaking`, `New Release`, `Free`, `Call an Ambulance`, `Last Chance`, `Updated`.
Não invente sin→nimos ou categorias sem mudan→a explícita da especificação.

## STAGES

`RADAR ? PREPARAÇÃO ? SELE→→O EDITORIAL ? BRANCH EDITORIAL ? PREVIEW / HUMAN REVIEW ? PUBLICATION GATE`.
Nunca avance automaticamente porque preço, fonte, checks, Verdict, Status ou preview parecem corretos. A decis→o antes de `/advance` → humana.

## /ADVANCE

`/advance` exige confirmação humana explícita. Sem confirmação: bloqueado. Com confirmação: transiciona o stage. Registre, quando aplic→vel, `fromStage`, `toStage`, `requestedAt`, `selected`, `ready`. `/advance` n→o significa publicação e n→o deve disparar JEV/AI Gateway na Fase 2.

## INVALIDAÇÃO

A aprovação corresponde ao estado aprovado. Se houver edi→→o, movimento, reordenação, desativação ou alteração editorial ap→s `/advance`, invalide:
`advance.ready = false`
`advance.selected = false`
O hist→rico de `requestedAt` pode permanecer.

## PERSISTÊNCIA

O Console atual usa `localStorage`. Não assuma publicação, deploy, alteração autom→tica do HTML público, GitHub, JEV ou AI Gateway. O Console → um workspace editorial local.

## IMPORT/EXPORT

Preserve `Export state` e `Import state`. Estado importado deve ser validado. Nunca aceite JSON externo cegamente.

## SCHEMA

O estado → versionado. Refer→ncia atual: `CONTENT_BLOCK_SCHEMA_VERSION = 2`.
Fluxo: `schema antigo ? migration ? schema atual ? validation`.
Não destrua dados em migrations. Preserve Verdict, Status, stage, sources, evidence, validation, publication e advance.

## VALIDAÇÃO

Valide: IDs obrigat→rios e →nicos; `type` permitido; `section` permitida; `position` inteiro n→o negativo; `content` objeto; links locais ou HTTPS; rejeite `javascript:` e URLs com credenciais; valide datas e metadados editoriais.

## COMPONENTES PÚBLICOS

O Console pode carregar páginas p→blicas para obter componentes reais. Refer→ncias: `/index.html`, `/articles/radar-setembro-22.html`, `/lab.html`.
Fluxo: `fetch ? parse HTML ? localizar componente ? reutilizar estrutura ? ContentBlock ? preview`.
Não duplique manualmente componentes existentes.

## BOOTSTRAP

Nunca deixe o Console preso silenciosamente em `Loading editorial content→`. Mostre erros contextuais identificando a fonte problem→tica. Diagn→stico: `/console/` ? fontes p→blicas ? DevTools ? Network ? Console ? identificar camada ? corrigir somente essa camada. Não esconda falhas usando mocks.

## INTERFACE

O editor deve poder: selecionar, editar, mover, reordenar, ativar/desativar, visualizar, criar via `+ Add Block`, editar estado editorial, exportar, importar e confirmar `/advance`. Exiba claramente `Editorial stage` e `Advance readiness`. `stage ? approval`.

## PREVIEW

Use identidade e componentes reais do ASP. Priorize estrutura, tipografia, hierarquia, conte→do, componentes, links e estado visual. Evite interface administrativa gen→rica que esconda o resultado editorial.

## NOTEBOOKLM / IA DE PESQUISA

Use IA de pesquisa para:
`fontes ? síntese ? evidências ? candidato editorial`.
Separe `FATO DA FONTE`, `INTERPRETAÇÃO`, `INFORMAÇÃO AUSENTE`, `PONTO A VALIDAR`.
Nunca transforme infer→ncia em fato.
Formato preferencial:

```text
SOURCE
URL:
ORIGIN:
DATE:
EVIDENCE
PRODUCT:
PRICE:
OFFER:
DATES:
TERMS:
EDITORIAL CANDIDATE
TYPE:
TITLE:
SUMMARY:
OPEN QUESTIONS
...
HUMAN DECISION
PENDING
```

## DEEPSEEK HARNESS / COPILOT / AGENTES DE C→DIGO

Antes de alterar: `ler README ? ler CONSOLE.MD ? localizar componentes ? localizar ContentBlock/state ? localizar testes ? entender fluxo ? menor alteração ? teste de regress→o ? testes/lint/build/validação ? apresentar resultado`.
Bug de carregamento = `diagn→stico ? corre→→o cir→rgica ? teste ? validação`. Não reescreva arquitetura, migre framework ou crie API/banco sem necessidade.

## CONTRATO DE SA→DA

Ao preparar material para o Console, use:

```text
CONTENT BLOCK
- ID
- TYPE
- SECTION
- POSITION
- CONTENT
- STATUS
EDITORIAL METADATA
- STAGE
- SOURCES
- EVIDENCE
- SELECTION
- VERDICT
- EDITORIAL STATUS
- VALIDATION
- PUBLICATION
- ADVANCE
HUMAN REVIEW
- pontos a confirmar
- dúvidas
- informação ausente
- riscos editoriais
```

## REGRA DE EVID→NCIA

`fonte confirmada ? publicação autorizada`.
Não invente fonte, preço, data, condi→→o, evidência ou fato.

## N→O FAZER

Não criar CMS, banco, React/Next sem necessidade, componentes falsos, fontes/preços/datas inventados, publicação autom→tica, avan→o autom→tico ou automação futura prematura. Não apagar metadados/hist→rico. Não usar Verdict/Status como autorização. Não tratar GitHub Kanban como substituto do Console.

## TESTE DE ACEITE

Verifique:

```text
[ ] /console abre
[ ] fontes p→blicas carregam
[ ] componentes reais aparecem
[ ] edi→→o funciona
[ ] edi→→o sobrevive ao reload
[ ] export/import funcionam
[ ] move/reorder funcionam
[ ] activate/deactivate funcionam
[ ] Verdict n→o avan→a sozinho
[ ] Status n→o avan→a sozinho
[ ] /advance exige confirmação humana
[ ] /advance registra transição
[ ] alteração posterior invalida readiness
[ ] estado inv→lido → rejeitado
[ ] links perigosos s→o rejeitados
[ ] migration preserva dados
[ ] testes/lint/build/validação passam
```

## AUTOMAÇÃO FUTURA

Arquitetura planejada:
`RADAR ? ASP CONSOLE ? HUMAN REVIEW ? /advance ? JEV ? Vercel AI Gateway ? VALIDATION ? PUBLICATION`.
Não implementar essa cadeia na Fase 2 sem instru→→o explícita.

## REGRA DE OURO

O Console organiza, apresenta, permite editar e registra o estado editorial. A IA pode pesquisar, sintetizar, encontrar evidências, preparar conte→do, sugerir estrutura, detectar inconsist→ncias e validar dados. A autoridade editorial permanece humana.

`ANTES DE /advance = human-in-the-loop`
`DEPOIS DE /advance = automation-ready`

## INSTRU→→O FINAL

Leia o estado atual e `CONSOLE.MD` quando dispon→vel. Use componentes reais. Modele como ContentBlock. Separe conte→do de metadados. Preserve Verdict, Status, fontes e evidências. Não invente fatos. Não trate validação como aprovação. Não avance automaticamente. Exija confirmação humana para `/advance`. Invalide readiness ap→s mudan→as. Preserve schema e hist→rico. Fa→a mudan→as pequenas. Teste tudo. Não introduza infraestrutura desnecessária.

**RESUMO:** Produza para o ASP como ContentBlocks que reutilizam componentes reais do site, mantenha conte→do separado de metadados editoriais, preserve evidências/Verdict/Status, nunca infira aprovação, mantenha o humano como autoridade antes de `/advance` e trate o estado ap→s `/advance` como pronto para futura automação → sem criar CMS, banco, framework ou publicação autom→tica desnecessários.
