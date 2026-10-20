import test from "node:test";
import assert from "node:assert/strict";
import {
  WA_ORIGIN,
  attachLinks,
  buildAffiliateLink,
  buildCampaignsDocument,
  buildProductRecords,
  classifyCampaigns,
  normalizeCampaigns,
  parseCommission,
  parseDelimited,
  parseWaProductLink,
  stripHtml,
  summarize
} from "../scripts/affiliate-campaigns.mjs";

const HEADER =
  '"ID";"Cookie lifetime";"Status";"affstatus";"Name";"description";"banners";"Commissions"';

test("the parser survives quoted delimiters, doubled quotes and embedded newlines", () => {
  const csv = [
    HEADER,
    '"a1";"30.00";"A";"A";"InstaChord";"First line',
    'second line";"6";"per Sale: 25% / 10%"'
  ].join("\n");

  const rows = parseDelimited(csv);
  assert.equal(rows.length, 2, "the embedded newline must not start a new record");
  assert.equal(rows[1][4], "InstaChord");
  assert.match(rows[1][5], /First line\nsecond line/);

  // A doubled quote is a literal quote.
  const quoted = parseDelimited('"x";"he said ""hi"""');
  assert.equal(quoted[0][1], 'he said "hi"');
});

test("the parser ignores a BOM and a trailing newline", () => {
  const rows = parseDelimited(`\ufeff${HEADER}\n"a1";"30";"A";"A";"n";"d";"1";"per Sale: 25%"\n`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][0], "ID");
});

test("HTML from the export is stripped and entities decoded", () => {
  const soup = '<span class="x" data-a="1">These are <br>banners &amp; <b>deals</b></span>';
  assert.equal(stripHtml(soup), "These are banners & deals");
  assert.equal(stripHtml("a&nbsp;&nbsp;b"), "a b");
  assert.equal(stripHtml("&quot;q&quot; &#39;s&#39;"), '"q" \'s\'');
  assert.equal(stripHtml(null), "");
});

test("commission is read with and without the tiered figure", () => {
  assert.deepEqual(parseCommission("per Sale: 25% / 10%"), {
    raw: "per Sale: 25% / 10%",
    perSale: 25,
    tiered: 10
  });
  // A flat rate must not become null: one campaign in the real export is like this.
  assert.deepEqual(parseCommission("per Sale: 25%"), {
    raw: "per Sale: 25%",
    perSale: 25,
    tiered: null
  });
  assert.deepEqual(parseCommission(""), { raw: "", perSale: null, tiered: null });
  assert.deepEqual(parseCommission("nonsense"), { raw: "nonsense", perSale: null, tiered: null });
});

test("columns are mapped by header name, not by position", () => {
  const reordered = [
    '"Name";"ID";"Commissions";"banners";"Status";"affstatus";"Cookie lifetime";"description"',
    '"Outlaw - Gain Rider";"01604579";"per Sale: 25% / 10%";"11";"A";"A";"30.00";"Gain rider"'
  ].join("\n");

  const [campaign] = normalizeCampaigns(parseDelimited(reordered));
  assert.equal(campaign.campaignId, "01604579");
  assert.equal(campaign.name, "Outlaw - Gain Rider");
  assert.equal(campaign.bannerCount, 11);
  assert.equal(campaign.cookieLifetimeDays, 30);
  assert.equal(campaign.commission.perSale, 25);
});

test("a missing required column is an error, not a silent empty field", () => {
  const broken = '"ID";"Name"\n"a1";"n"';
  assert.throws(() => normalizeCampaigns(parseDelimited(broken)), /missing the "Status" column/);
});

test("the blank tail row and empty ids are dropped", () => {
  const csv = [HEADER, '"a1";"30";"A";"A";"n";"d";"1";"per Sale: 25%"', "", '"";"30";"A";"A";"n";"d";"1";"x"'].join("\n");
  const campaigns = normalizeCampaigns(parseDelimited(csv));
  assert.equal(campaigns.length, 1);
});

test("sections and products are told apart, and sections keep their name", () => {
  const csv = [
    HEADER,
    '"1";"30";"A";"A";"WAProd - Membership";"d";"18";"per Sale: 30% / 10%"',
    '"2";"30";"A";"A";"InstaChord - MIDI Processing Plugin";"d";"6";"per Sale: 25% / 10%"'
  ].join("\n");

  const [membership, instachord] = classifyCampaigns(normalizeCampaigns(parseDelimited(csv)));
  assert.equal(membership.kind, "section");
  assert.equal(membership.section, "Membership");
  assert.equal(instachord.kind, "product");
  assert.equal(instachord.section, null);
});

test("the document never carries an invented link", () => {
  const csv = [HEADER, '"1";"30";"A";"A";"WAProd - General";"d";"22";"per Sale: 25% / 5%"'].join("\n");
  const document = buildCampaignsDocument(normalizeCampaigns(parseDelimited(csv)), {
    source: "grid.csv",
    importedAt: "2026-10-20T00:00:00.000Z"
  });

  assert.equal(document.format, "asp-affiliate-campaigns");
  assert.equal(document.programId, "wa-production");
  // The export has no click URLs, so the template stays null on purpose.
  assert.equal(document.linkTemplate, null);
  assert.equal(document.campaigns[0].linkTemplate, null);
  assert.equal(document.campaigns[0].destinationUrl, null);
});

test("the summary reports the real shape of the export", () => {
  const campaigns = [
    { status: "A", kind: "section", bannerCount: 75, commission: { perSale: 25 } },
    { status: "A", kind: "product", bannerCount: 6, commission: { perSale: 25 } },
    { status: "A", kind: "section", bannerCount: 18, commission: { perSale: 30 } }
  ];
  const summary = summarize({ campaigns });
  assert.equal(summary.total, 3);
  assert.equal(summary.sections, 2);
  assert.equal(summary.products, 1);
  assert.equal(summary.active, 3);
  assert.equal(summary.banners, 99);
  assert.equal(summary.best.commission.perSale, 30);
});

test("the link builder reproduces a link the account actually issued", () => {
  // Golden case: this exact URL was copied from the Post Affiliate Pro panel.
  assert.equal(
    buildAffiliateLink({
      path: "/plugins/view/instacomposer",
      bannerId: "5216a985",
      affiliateId: "tl5yyfu43dtnu"
    }),
    "https://www.waproduction.com/plugins/view/instacomposer#a_aid=tl5yyfu43dtnu&a_bid=5216a985"
  );
  assert.equal(
    buildAffiliateLink({ path: "/bundles", bannerId: "11d8a200", affiliateId: "tl5yyfu43dtnu" }),
    "https://www.waproduction.com/bundles#a_aid=tl5yyfu43dtnu&a_bid=11d8a200"
  );
  assert.equal(WA_ORIGIN, "https://www.waproduction.com");
});

test("the link builder refuses an incomplete or unsafe link", () => {
  const base = { path: "/bundles", bannerId: "11d8a200", affiliateId: "tl5yyfu43dtnu" };
  assert.throws(() => buildAffiliateLink({ ...base, affiliateId: null }), /affiliate id/);
  assert.throws(() => buildAffiliateLink({ ...base, affiliateId: "a" }), /affiliate id/);
  assert.throws(() => buildAffiliateLink({ ...base, bannerId: "" }), /banner id/);
  assert.throws(() => buildAffiliateLink({ ...base, path: "bundles" }), /must start with/);
  assert.throws(() => buildAffiliateLink({ ...base, path: "https://evil.example/x" }), /must start with/);
});

function documentWith(campaignIds) {
  const rows = [
    '"ID";"Cookie lifetime";"Status";"affstatus";"Name";"description";"banners";"Commissions"',
    ...campaignIds.map(
      (id, index) => `"${id}";"30";"A";"A";"WAProd - S${index}";"d";"1";"per Sale: 25% / 10%"`
    )
  ];
  return buildCampaignsDocument(normalizeCampaigns(parseDelimited(rows.join("\n"))), {
    importedAt: "2026-10-20T00:00:00.000Z"
  });
}

test("a link is bound to its campaign by id, and an unbound one stays standalone", () => {
  const result = attachLinks(
    documentWith(["aaaa1111", "bbbb2222"]),
    [
      { campaignId: "bbbb2222", path: "/plugins/view/x", bannerId: "5216a985" },
      { path: "/bundles", bannerId: "11d8a200", label: "Bundles" }
    ],
    { affiliateId: "tl5yyfu43dtnu" }
  );

  const bound = result.campaigns.find((entry) => entry.campaignId === "bbbb2222");
  assert.equal(bound.destinationUrl, "https://www.waproduction.com/plugins/view/x#a_aid=tl5yyfu43dtnu&a_bid=5216a985");
  assert.equal(bound.bannerId, "5216a985");
  assert.equal(result.campaigns.find((entry) => entry.campaignId === "aaaa1111").destinationUrl, null);

  assert.equal(result.standaloneLinks.length, 1);
  assert.equal(result.standaloneLinks[0].destinationUrl, "https://www.waproduction.com/bundles#a_aid=tl5yyfu43dtnu&a_bid=11d8a200");
  assert.equal(result.linkTemplate, "https://www.waproduction.com{path}#a_aid=tl5yyfu43dtnu&a_bid={bannerId}");
});

test("a link naming an unknown campaign is an error, not silently dropped", () => {
  assert.throws(
    () => attachLinks(documentWith(["aaaa1111"]), [{ campaignId: "zzzz9999", path: "/x", bannerId: "5216a985" }], {
      affiliateId: "tl5yyfu43dtnu"
    }),
    /unknown campaign id/
  );
});

test("no links means the document is returned untouched", () => {
  const document = documentWith(["aaaa1111"]);
  assert.equal(attachLinks(document, [], { affiliateId: "tl5yyfu43dtnu" }), document);
  assert.equal(attachLinks(document, undefined, { affiliateId: "tl5yyfu43dtnu" }), document);
});

test("a WA product link is pulled apart into slug, section, ids and a clean URL", () => {
  const parsed = parseWaProductLink(
    "https://www.waproduction.com/bundles/view/vocal-mega-pack-3#a_aid=tl5yyfu43dtnu&a_bid=16a4868c",
    { name: "Vocal Mega Pack 3" }
  );

  assert.equal(parsed.slug, "vocal-mega-pack-3");
  assert.equal(parsed.section, "bundles");
  assert.equal(parsed.category, "bundle");
  assert.equal(parsed.affiliateId, "tl5yyfu43dtnu");
  assert.equal(parsed.bannerId, "16a4868c");
  assert.equal(parsed.name, "Vocal Mega Pack 3");
  assert.equal(
    parsed.destinationUrl,
    "https://www.waproduction.com/bundles/view/vocal-mega-pack-3#a_aid=tl5yyfu43dtnu&a_bid=16a4868c"
  );
  assert.equal(parsed.fallbackUrl, "https://www.waproduction.com/bundles/");

  assert.equal(
    parseWaProductLink("https://www.waproduction.com/plugins/view/midiq#a_aid=tl5yyfu43dtnu&a_bid=8a8173be", {
      name: "MIDIQ"
    }).category,
    "plugin"
  );
});

test("a product link is refused when it is not attributable or not a product page", () => {
  const base = "https://www.waproduction.com/plugins/view/midiq";
  const name = { name: "MIDIQ" };

  assert.throws(() => parseWaProductLink(`${base}#a_aid=tl5yyfu43dtnu`, name), /no a_bid/);
  assert.throws(() => parseWaProductLink(`${base}#a_bid=8a8173be`, name), /no a_aid/);
  assert.throws(() => parseWaProductLink("https://evil.example/plugins/view/midiq", name), /Only https/);
  assert.throws(() => parseWaProductLink("https://www.waproduction.com/bundles", name), /product path/);
  // The name must come from the page, never from the slug.
  assert.throws(() => parseWaProductLink(`${base}#a_aid=tl5yyfu43dtnu&a_bid=8a8173be`, { name: "  " }), /verified name/);
});

test("catalog records pair every product with its reviewed link", () => {
  const { products, affiliateLinks } = buildProductRecords(
    [
      {
        url: "https://www.waproduction.com/plugins/view/midiq#a_aid=tl5yyfu43dtnu&a_bid=8a8173be",
        name: "MIDIQ"
      }
    ],
    { verifiedAt: "2026-10-20T00:00:00.000Z" }
  );

  assert.equal(products.length, 1);
  assert.equal(products[0].id, "wa-production-midiq");
  assert.equal(products[0].programId, "wa-production");
  assert.equal(products[0].category, "plugin");

  assert.equal(affiliateLinks.length, 1);
  assert.equal(affiliateLinks[0].id, "link-wa-production-midiq");
  assert.equal(affiliateLinks[0].productId, "wa-production-midiq");
  assert.equal(affiliateLinks[0].requiresReview, false);
  assert.equal(affiliateLinks[0].lastVerifiedAt, "2026-10-20T00:00:00.000Z");
});

test("a duplicate product slug is refused instead of overwriting silently", () => {
  const link = {
    url: "https://www.waproduction.com/plugins/view/midiq#a_aid=tl5yyfu43dtnu&a_bid=8a8173be",
    name: "MIDIQ"
  };
  assert.throws(() => buildProductRecords([link, link]), /Duplicate product id/);
  assert.throws(() => buildProductRecords([]), /No product links/);
});
