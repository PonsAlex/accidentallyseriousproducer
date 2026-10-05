import { isPromotionPublic } from "./affiliate-core.mjs";
import { loadAffiliateData } from "./affiliate-data.mjs";
import {
  loadPublicComponentTemplates,
  PUBLIC_COMPONENT_BLOCK_IDS
} from "./public-component-templates.mjs";
import {
  EDITORIAL_STAGE_ORDER,
  CONTENT_SECTIONS,
  CONTENT_TYPE_SECTIONS,
  EDITORIAL_STATUSES,
  EDITORIAL_VERDICTS,
  addEditorialBlockToState,
  advanceEditorialBlock,
  createInitialEditorialState,
  invalidateEditorialAdvance,
  migrateEditorialState,
  moveEditorialBlock,
  normalizeBlockPositions,
  validateEditorialState
} from "./content-blocks.mjs";

const STORAGE_KEY = "asp-editorial-console-v1";
const stateStatus = document.querySelector("#console-status");
const contentList = document.querySelector("#content-list");
const preview = document.querySelector("#page-preview");
const editor = document.querySelector("#block-editor");
const dataInput = document.querySelector("#state-import");
const addBlockDialog = document.querySelector("#add-block-dialog");
const addBlockForm = document.querySelector("#add-block-form");
const addBlockType = document.querySelector("#add-block-type");
const addBlockSection = document.querySelector("#add-block-section");

let state;
let promotionsById;
let productsById;
let renderPublicComponent;
let selectedBlockId = null;

function validateConsoleState(value) {
  validateEditorialState(value);
  for (const block of value.blocks) {
    if (block.type === "deal") {
      if (!block.content.promotionId) {
        if (block.status === "draft" && block.metadata.publication.state === "unpublished") continue;
        throw new TypeError(`Deal block ${block.id} needs an approved public promotion.`);
      }
      const promotion = promotionsById.get(block.content.promotionId);
      if (!promotion || !isPromotionPublic(promotion)) {
        throw new TypeError(`Deal block ${block.id} does not reference an approved public promotion.`);
      }
      continue;
    }
    if (!renderPublicComponent?.hasTemplate(block.id, block.type)) {
      throw new TypeError(`Content block ${block.id} does not match an existing public component.`);
    }
  }
  return value;
}

function toggleBlock(id) {
  const block = getBlock(id);
  if (!block) return;
  block.metadata.enabled = !block.metadata.enabled;
  invalidateEditorialAdvance(block);
  saveState(block.metadata.enabled ? "Component reactivated." : "Component deactivated. Editorial metadata was retained.", true);
}

function requestAdvance(id) {
  const block = getBlock(id);
  if (!block) return;
  const nextStage = EDITORIAL_STAGE_ORDER[EDITORIAL_STAGE_ORDER.indexOf(block.metadata.editorialStage) + 1];
  if (!nextStage) {
    statusMessage("Publication Gate is terminal; this item cannot advance further.", true);
    return;
  }
  if (!window.confirm(`Confirm editorial changes and authorize /advance for "${getBlockTitle(block)}"?\n\n${block.metadata.editorialStage} → ${nextStage}\n\nThis records an explicit local signal only; it does not publish or call external automation.`)) {
    return;
  }
  try {
    const result = advanceEditorialBlock(block, {
      confirmed: true,
      requestedAt: new Date().toISOString()
    });
    saveState(`/advance explicitly confirmed: ${result.fromStage} → ${result.toStage}. No automation or publication was triggered.`, true);
  } catch (error) {
    statusMessage(`Could not advance editorial item: ${error.message}`, true);
  }
}

function statusMessage(message, isError = false) {
  stateStatus.textContent = message;
  stateStatus.classList.toggle("console-message--error", isError);
}

function getBlock(id) {
  return state.blocks.find((block) => block.id === id);
}

function getBlockTitle(block) {
  if (block.type === "deal") {
    const promotion = promotionsById.get(block.content.promotionId);
    return productsById.get(promotion?.productId)?.name ?? block.content.promotionId ?? "Deal needs promotion data";
  }
  return block.content.title || block.id;
}

function saveState(message = "Changes saved in this browser.", includeEditor = false) {
  state.blocks = normalizeBlockPositions(state.blocks);
  try {
    validateConsoleState(state);
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    statusMessage(`Could not save editorial state: ${error.message}`, true);
    return;
  }
  render({ includeEditor });
  statusMessage(message);
}

function createElement(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function createSelect(labelText, name, options, value) {
  const label = createElement("label", "console-field");
  label.append(createElement("span", "", labelText));
  const select = document.createElement("select");
  select.name = name;
  select.dataset.field = name;
  for (const option of options) {
    const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, option];
    const item = createElement("option", "", optionLabel);
    item.value = optionValue;
    select.append(item);
  }
  select.value = value ?? "";
  label.append(select);
  return label;
}

function createInput(labelText, name, value, { multiline = false, type = "text" } = {}) {
  const label = createElement("label", "console-field");
  label.append(createElement("span", "", labelText));
  const input = multiline
    ? document.createElement("textarea")
    : document.createElement("input");
  if (!multiline) input.type = type;
  input.name = name;
  input.dataset.field = name;
  input.value = value ?? "";
  label.append(input);
  return label;
}

function createCheckbox(labelText, name, checked) {
  const label = createElement("label", "console-check");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = name;
  input.dataset.field = name;
  input.checked = Boolean(checked);
  label.append(input, createElement("span", "", labelText));
  return label;
}

function renderBlockEditor(block) {
  editor.replaceChildren();
  if (!block) {
    editor.append(createElement("p", "console-empty", "Select a content block to edit its content and editorial metadata."));
    return;
  }

  editor.append(createElement("h2", "", "Edit selected content"));
  editor.append(createElement("p", "console-block-id", `${block.type} · ${block.id}`));
  editor.append(createSelect(
    "Page section",
    "section",
    Object.entries(CONTENT_SECTIONS),
    block.section
  ));
  editor.append(createSelect(
    "Record status (does not publish)",
    "status",
    ["draft", "review", "approved", "published", "archived"],
    block.status
  ));
  const positionField = createInput("Order / position", "position", block.position, { type: "number" });
  positionField.querySelector("input").min = "0";
  positionField.querySelector("input").step = "10";
  editor.append(positionField);

  const fields = {
    hero: [
      ["Eyebrow", "eyebrow"],
      ["Heading", "title", true],
      ["Introduction", "intro", true],
      ["Panel label", "panelLabel"],
      ["Panel text", "panelText", true]
    ],
    article: [
      ["Tag", "tag"],
      ["Title", "title"],
      ["Deck", "deck", true],
      ["Summary", "body", true],
      ["Link URL", "href"],
      ["Link label", "linkLabel"],
      ["Published date", "date"]
    ],
    "product-review": [
      ["Product title", "title"],
      ["Summary", "body", true],
      ["Verdict text", "verdict", true],
      ["Component label (display copy)", "reviewLabel"],
      ["Link URL", "href"],
      ["Link label", "linkLabel"]
    ],
    deal: [],
    project: [
      ["Badge", "badge"],
      ["Project title", "title"],
      ["Project stage", "stage"],
      ["Description", "body", true],
      ["Current focus", "focus", true],
      ["Next milestone", "milestone", true]
    ]
  };

  for (const [label, name, multiline] of fields[block.type] ?? []) {
    editor.append(createInput(label, `content.${name}`, block.content[name], { multiline }));
  }
  if (block.type === "deal") {
    const approvedPromotions = [...promotionsById.values()]
      .filter(isPromotionPublic)
      .sort((left, right) => left.id.localeCompare(right.id));
    editor.append(createSelect(
      "Approved public promotion",
      "content.promotionId",
      [
        ["", "No approved promotion selected"],
        ...approvedPromotions.map((promotion) => [
          promotion.id,
          `${productsById.get(promotion.productId)?.name ?? promotion.id} · ${promotion.id}`
        ])
      ],
      block.content.promotionId
    ));
    editor.append(createElement(
      "p",
      "console-process-note",
      block.content.promotionId
        ? `Offer facts are controlled by the reviewed promotion and product records (${block.content.promotionId}); this block uses the public offer component.`
        : "This deal stays incomplete until you select an approved public promotion. No offer facts are created here."
    ));
  }

  const metadata = createElement("details", "console-metadata");
  const metadataSummary = createElement("summary", "", "Editorial metadata");
  metadata.append(metadataSummary);
  metadata.append(createSelect(
    "Editorial selection",
    "metadata.selection",
    ["", "Develop", "Monitor", "Roundup", "Update existing article", "Discard"],
    block.metadata.selection
  ));
  metadata.append(createSelect(
    "Verdict",
    "metadata.verdict",
    [["", "Not assigned"], ...EDITORIAL_VERDICTS],
    block.metadata.verdict
  ));
  metadata.append(createSelect(
    "Editorial status",
    "metadata.editorialStatus",
    EDITORIAL_STATUSES,
    block.metadata.editorialStatus
  ));
  metadata.append(createInput(
    "Sources (one URL or note per line)",
    "metadata.sources",
    block.metadata.sources.join("\n"),
    { multiline: true }
  ));

  const evidenceGroup = createElement("fieldset", "console-check-group");
  evidenceGroup.append(createElement("legend", "", "Evidence"));
  for (const [key, label] of [
    ["sourceConfirmed", "Primary source confirmed"],
    ["productConfirmed", "Product confirmed"],
    ["priceConfirmed", "Price confirmed"],
    ["datesConfirmed", "Dates confirmed"],
    ["termsConfirmed", "Terms confirmed"],
    ["sufficient", "Evidence sufficient"]
  ]) {
    evidenceGroup.append(createCheckbox(label, `metadata.evidence.${key}`, block.metadata.evidence[key]));
  }
  metadata.append(evidenceGroup);

  const validationGroup = createElement("fieldset", "console-check-group");
  validationGroup.append(createElement("legend", "", "Human validation"));
  for (const [key, label] of [
    ["claims", "Claims correct"],
    ["price", "Price correct"],
    ["dates", "Dates correct"],
    ["terms", "Terms correct"],
    ["status", "Status correct"],
    ["recut", "Editorial cut correct"],
    ["verdict", "Verdict correct"],
    ["links", "Links correct"],
    ["previewApproved", "Preview approved"]
  ]) {
    validationGroup.append(createCheckbox(label, `metadata.validation.${key}`, block.metadata.validation[key]));
  }
  metadata.append(validationGroup);
  metadata.append(createElement(
    "p",
    "console-process-note",
    `Publication: ${block.metadata.publication.state}. Advance selected: ${block.metadata.advance.selected ? "yes" : "no"}. Ready signal: ${block.metadata.advance.ready ? "yes" : "no"}.`
  ));
  editor.append(metadata);
  const nextStage = EDITORIAL_STAGE_ORDER[EDITORIAL_STAGE_ORDER.indexOf(block.metadata.editorialStage) + 1];
  const advance = createElement("div", "console-advance-control");
  const processSummary = createElement(
    "p",
    "console-process-note",
    `Editorial stage: ${block.metadata.editorialStage}. Advance readiness: ${block.metadata.advance.ready ? "confirmed" : "not confirmed"}. Stage changes only through explicit /advance confirmation.`
  );
  processSummary.dataset.advanceSummary = "";
  advance.append(processSummary);
  if (nextStage) {
    const advanceButton = createElement("button", "button button-primary", `Confirm & /advance → ${nextStage}`);
    advanceButton.type = "button";
    advanceButton.dataset.advanceBlock = block.id;
    advance.append(advanceButton);
  } else {
    advance.append(createElement("p", "console-process-note", "Publication Gate is terminal."));
  }
  editor.append(advance);
  const activationButton = createElement(
    "button",
    "button button-secondary console-activation-control",
    block.metadata.enabled ? "Deactivate component" : "Reactivate component"
  );
  activationButton.type = "button";
  activationButton.dataset.toggleBlock = block.id;
  editor.append(activationButton);
}

function appendPreviewBlock(block) {
  const wrapper = createElement("article", "console-preview-item");
  wrapper.dataset.blockId = block.id;
  wrapper.draggable = true;
  wrapper.tabIndex = 0;
  wrapper.setAttribute("aria-label", `${getBlockTitle(block)} content block`);
  if (block.id === selectedBlockId) wrapper.classList.add("is-selected");

  const typeLabel = createElement("span", "console-type-label", block.type.replace("-", " "));
  typeLabel.setAttribute("aria-hidden", "true");
  wrapper.append(typeLabel);
  if (block.status !== "published") {
    wrapper.append(createElement("span", "console-draft-label", block.status));
  }

  wrapper.append(renderPublicComponent(block));
  if (block.type === "deal" && !block.content.promotionId) {
    wrapper.append(createElement(
      "p",
      "console-deal-description",
      "Select an approved public promotion to preview this deal."
    ));
  }
  return wrapper;
}

function render({ includeEditor = true } = {}) {
  const sorted = normalizeBlockPositions(state.blocks);
  contentList.replaceChildren();
  for (const block of sorted) {
    const item = createElement("li", "console-inbox-item");
    const button = createElement("button", "console-inbox-button");
    button.type = "button";
    button.dataset.selectBlock = block.id;
    button.draggable = true;
    button.append(
      createElement("span", "console-inbox-type", block.type.replace("-", " ")),
      createElement("strong", "", getBlockTitle(block)),
      createElement("span", "console-inbox-meta", `${CONTENT_SECTIONS[block.section]} · ${block.status}${block.metadata.enabled ? "" : " · inactive"}`)
    );
    if (block.id === selectedBlockId) button.classList.add("is-selected");
    item.append(button);
    contentList.append(item);
  }

  preview.replaceChildren();
  for (const [section, title] of Object.entries(CONTENT_SECTIONS)) {
    const sectionBlocks = sorted.filter((block) => block.section === section);
    const lane = createElement("section", "console-preview-lane");
    lane.dataset.section = section;
    lane.append(
      createElement("div", "console-lane-heading", title),
      createElement("div", "console-lane-content")
    );
    const laneContent = lane.querySelector(".console-lane-content");
    if (sectionBlocks.length === 0) {
      laneContent.append(createElement("p", "console-empty-lane", "Drop a content block here."));
    }
    for (const block of sectionBlocks) {
      if (block.metadata.enabled) laneContent.append(appendPreviewBlock(block));
    }
    if (sectionBlocks.length > 0 && !sectionBlocks.some((block) => block.metadata.enabled)) {
      laneContent.append(createElement("p", "console-empty-lane", "All blocks in this section are inactive."));
    }
    preview.append(lane);
  }
  if (includeEditor) renderBlockEditor(getBlock(selectedBlockId));
}

function updateBlockField(block, path, value) {
  const keys = path.split(".");
  let parent = block;
  for (const key of keys.slice(0, -1)) parent = parent[key];
  parent[keys.at(-1)] = value;
}

function handleEditorChange(event) {
  const field = event.target.dataset.field;
  if (!field) return;
  const block = getBlock(selectedBlockId);
  if (!block) return;

  let value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  if (field === "position") value = Number(value);
  if (field.endsWith(".href") && value === "") value = undefined;
  if (field === "content.promotionId" && value === "") value = null;
  if (field === "metadata.sources") {
    value = value.split(/\r?\n/).map((source) => source.trim()).filter(Boolean);
  }
  invalidateEditorialAdvance(block);
  const summary = editor.querySelector("[data-advance-summary]");
  if (summary) summary.textContent = `Editorial stage: ${block.metadata.editorialStage}. Advance readiness: not confirmed. Stage changes only through explicit /advance confirmation.`;
  updateBlockField(block, field, value);
  saveState();
}

function updateAddBlockSections() {
  const sections = CONTENT_TYPE_SECTIONS[addBlockType.value] ?? [];
  addBlockSection.replaceChildren();
  for (const section of sections) {
    const option = createElement("option", "", CONTENT_SECTIONS[section]);
    option.value = section;
    addBlockSection.append(option);
  }
}

function addBlock(event) {
  event.preventDefault();
  try {
    const nextState = addEditorialBlockToState(state, {
      type: addBlockType.value,
      section: addBlockSection.value
    });
    validateConsoleState(nextState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    state = nextState;
    selectedBlockId = state.blocks.at(-1).id;
    addBlockDialog.close();
    addBlockForm.reset();
    updateAddBlockSections();
    render();
    statusMessage("Content block created and saved in this browser as a draft.");
  } catch (error) {
    statusMessage(`Could not add content block: ${error.message}`, true);
  }
}

function selectBlock(id) {
  if (!getBlock(id)) return;
  selectedBlockId = id;
  render();
}

function moveBlock(id, section, beforeId = null) {
  try {
    state.blocks = moveEditorialBlock(state.blocks, { id, section, beforeId });
    invalidateEditorialAdvance(getBlock(id));
    saveState("Content block moved and saved in this browser.", true);
  } catch (error) {
    statusMessage(`Could not move content block: ${error.message}`, true);
  }
}

function handleDragStart(event) {
  const source = event.target.closest("[data-block-id], [data-select-block]");
  const id = source?.dataset.blockId ?? source?.dataset.selectBlock;
  if (!id) return;
  event.dataTransfer.setData("text/plain", id);
  event.dataTransfer.effectAllowed = "move";
}

function handleDrop(event) {
  const lane = event.target.closest(".console-preview-lane");
  if (!lane) return;
  event.preventDefault();
  const id = event.dataTransfer.getData("text/plain");
  const beforeId = event.target.closest("[data-block-id]")?.dataset.blockId ?? null;
  moveBlock(id, lane.dataset.section, beforeId);
}

function exportState() {
  const file = new Blob([`${JSON.stringify(state, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = "asp-editorial-state.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  statusMessage("Editorial state exported as JSON.");
}

async function importState(file) {
  if (!file) return;
  try {
    const imported = migrateEditorialState(JSON.parse(await file.text()));
    validateConsoleState(imported);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
    state = imported;
    selectedBlockId = null;
    render();
    statusMessage("Editorial state imported and saved in this browser.");
  } catch (error) {
    statusMessage(`Could not import editorial state: ${error.message}`, true);
  } finally {
    dataInput.value = "";
  }
}

async function start() {
  try {
    const affiliateData = await loadAffiliateData();
    promotionsById = new Map(affiliateData.promotions.map((promotion) => [promotion.id, promotion]));
    productsById = new Map(affiliateData.products.map((product) => [product.id, product]));
    const publicTemplates = await loadPublicComponentTemplates();
    renderPublicComponent = publicTemplates.renderPublicComponent;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const importedState = JSON.parse(stored);
      state = validateConsoleState(migrateEditorialState(importedState));
      if (importedState.schemaVersion !== state.schemaVersion) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } else {
      const publicComponents = Object.fromEntries(
        PUBLIC_COMPONENT_BLOCK_IDS.map((id) => [id, publicTemplates.readInitialContent(id)])
      );
      state = createInitialEditorialState(affiliateData, publicComponents);
    }
    if (!stored) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
    if (state.blocks.length > 0) selectedBlockId = state.blocks[0].id;
    render();
    document.querySelector("#add-block").addEventListener("click", () => {
      updateAddBlockSections();
      addBlockDialog.showModal();
    });
    document.querySelector("#cancel-add-block").addEventListener("click", () => {
      addBlockDialog.close();
    });
    addBlockType.addEventListener("change", updateAddBlockSections);
    addBlockForm.addEventListener("submit", addBlock);
    document.querySelector("#export-state").addEventListener("click", exportState);
    dataInput.addEventListener("change", () => importState(dataInput.files?.[0]));
    editor.addEventListener("input", handleEditorChange);
    document.addEventListener("click", (event) => {
      if (event.target.closest(".console-preview-item a")) event.preventDefault();
      const button = event.target.closest("[data-select-block]");
      if (button) selectBlock(button.dataset.selectBlock);
      const advanceButton = event.target.closest("[data-advance-block]");
      if (advanceButton) requestAdvance(advanceButton.dataset.advanceBlock);
      const toggleButton = event.target.closest("[data-toggle-block]");
      if (toggleButton) toggleBlock(toggleButton.dataset.toggleBlock);
      const previewBlock = event.target.closest("[data-block-id]");
      if (previewBlock) selectBlock(previewBlock.dataset.blockId);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const previewBlock = event.target.closest("[data-block-id]");
      if (!previewBlock || event.target.closest("a, button, input, textarea, select")) return;
      event.preventDefault();
      selectBlock(previewBlock.dataset.blockId);
    });
    document.addEventListener("dragstart", handleDragStart);
    document.addEventListener("dragover", (event) => {
      if (event.target.closest(".console-preview-lane")) event.preventDefault();
    });
    document.addEventListener("drop", handleDrop);
    statusMessage(`Loaded ${state.blocks.length} existing ASP content blocks. State is local to this browser.`);
  } catch (error) {
    statusMessage(`Could not load editorial content: ${error.message}`, true);
  }
}

start();
