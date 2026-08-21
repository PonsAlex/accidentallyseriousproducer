export const STAGE_TITLES = {
  RADAR: "Radar",
  PREPARAÇÃO: "Preparação",
  EVIDÊNCIA: "O que conseguimos provar?",
  "FREE QUALIFICATION": "Free qualification",
  "SELEÇÃO EDITORIAL": "Seleção editorial",
  "BRANCH EDITORIAL": "Branch editorial",
  "PREVIEW / HUMAN REVIEW": "Preview / Human review",
  "PUBLICATION GATE": "Publication gate"
};

// Official ASP checklists for each stage
export const STAGE_CHECKLISTS = {
  RADAR: [
    "Oferta",
    "Freebie",
    "Novo produto",
    "Atualização",
    "Notícia",
    "Outro",
    "Ignorar"
  ],
  EVIDÊNCIA: [
    "Fonte primária confirmada",
    "Produto confirmado",
    "Preço confirmado",
    "Prazo confirmado",
    "Condições confirmadas",
    "Evidência suficiente",
    "Evidência insuficiente",
    "Revisão necessária"
  ],
  "FREE QUALIFICATION": [
    "Free",
    "Free temporário",
    "Requer compra",
    "Requer código",
    "Requer cadastro",
    "Trial",
    "Não é Free",
    "Inconclusivo"
  ],
  "SELEÇÃO EDITORIAL": [
    "Desenvolver",
    "Monitorar",
    "Agrupar em roundup",
    "Atualizar artigo existente",
    "Descartar"
  ],
  "BRANCH EDITORIAL": [
    {
      title: "Branch editorial — Status",
      items: [
        "Breaking",
        "New Release",
        "Free",
        "Call an Ambulance",
        "Last Chance",
        "Updated"
      ]
    },
    {
      title: "Branch editorial — Recorte",
      items: [
        "Notícia curta",
        "Deal alert",
        "Freebie alert",
        "Lançamento",
        "Atualização",
        "Análise",
        "Review",
        "Roundup"
      ]
    },
    {
      title: "Branch editorial — Verdict",
      items: [
        "Fire",
        "Stash",
        "Digital Furniture",
        "Nah",
        "Sem Verdict"
      ]
    }
  ],
  "PREVIEW / HUMAN REVIEW": [
    "Claims corretos",
    "Preço correto",
    "Prazo correto",
    "Condições corretas",
    "Status correto",
    "Recorte correto",
    "Verdict correto",
    "Links corretos",
    "Preview aprovado",
    "Voltar para evidências",
    "Voltar para Branch Editorial"
  ],
  "PUBLICATION GATE": [
    "Approve Merge",
    "Hold",
    "Reject",
    "Return to Review"
  ]
};
