"use strict";

/**
 * The html_samples/ folder is generated from samples.js (which stays the
 * source of truth for the demo page). This test renders the expected files,
 * checks that the ones on disk match, and checks that they are still good
 * inputs for the parser.
 *
 * To regenerate the folder after changing samples.js:
 *   WRITE_HTML_SAMPLES=1 npm test
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { html2json } = require("../html2json.js");
const { SAMPLES } = require("../samples.js");
const { strictParser, checkInvariants } = require("./helpers.js");

const DIR = path.join(__dirname, "..", "html_samples");
const WRITE = process.env.WRITE_HTML_SAMPLES === "1";

const STRESS = "Stress (generated)"; // generated on demand, too large to store
const EDGE = "Input edge cases"; // the bytes themselves are the sample (BOM, whitespace)

/** Why the samples of these groups cannot share one input. */
const SEPARATE = {
    "Tree repair":
        "Some of these samples deliberately leave elements open, so they would swallow the samples after them.",
    "Truncated input":
        "Every one of these samples ends in the middle of a construct, so each must be the very end of its input: copy it without the line break after it.",
    "maxDepth option":
        "Each case needs its own value in the Max depth field, which its label gives.",
};

const slug = (group) =>
    group.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The label as written in a delimiter comment: "--" would end the comment, so it is swapped for look-alike hyphens. */
function delimiterLabel(item) {
    const label = item.label.replace(/-{2,}/g, (dashes) => "\u2011".repeat(dashes.length));
    return item.maxDepth === undefined ? label : `${label} [Max depth: ${item.maxDepth}]`;
}

const delimiterLine = (item) => `<!-- ===== ${delimiterLabel(item)} ===== -->`;

/** True if the sample leaves an element open (or an unfinished construct) at its end. */
function leavesOpen(item) {
    const tree = html2json(item.html + "\n<hr id=sentinel>");
    return !tree.children.some((node) => node.type === "element" && node.tag === "hr");
}

const comment = (lines) => `<!--\n  ${lines.join("\n  ")}\n-->\n\n`;

/** The samples of a group in file order: samples that leave something open go last. */
function fileOrder(group, items) {
    if (group in SEPARATE) return items;
    return [...items.filter((item) => !leavesOpen(item)), ...items.filter(leavesOpen)];
}

function renderGroup(group, items) {
    const ordered = fileOrder(group, items);
    const count = `${ordered.length} sample${ordered.length === 1 ? "" : "s"}`;

    let lines;
    if (group in SEPARATE) {
        lines = [
            `Group: ${group} (${count})`,
            'INDEPENDENT cases: paste ONE sample at a time (the lines between one "=====" line and the next).',
            SEPARATE[group],
        ];
    } else {
        lines = [
            `Group: ${group} (${count})`,
            "This whole file is ONE valid input: paste it into the page to convert all the samples at once.",
            'To try a single sample, copy the lines between one "=====" line and the next.',
        ];
        if (ordered.some(leavesOpen)) {
            lines.push("A sample that leaves an element open is placed last, so that it cannot swallow the others.");
        }
    }

    const cases = ordered.map((item) => `${delimiterLine(item)}\n${item.html}\n\n`);
    return comment(lines) + cases.join("");
}

/** Every file of the folder, as { name, group, content }. */
function renderFiles() {
    const files = [];
    SAMPLES.forEach(({ group, items }, index) => {
        if (group === STRESS) return;
        const name = `${String(index + 1).padStart(2, "0")}-${slug(group)}.html`;

        let content;
        if (group === EDGE) {
            // No header: the file must start with the BOM. The empty-input sample is
            // nothing, so it has no text to store.
            const bom = items.find((item) => item.html.startsWith("\uFEFF"));
            const whitespace = items.find((item) => item.html.length > 0 && item.html.trim() === "");
            content = bom.html + whitespace.html;
        } else {
            content = renderGroup(group, items);
        }
        files.push({ name, group, items, content });
    });
    return files;
}

/** Splits a rendered file back into { label, text } cases. */
function splitCases(content) {
    const parts = content.split(/^<!-- ===== (.*) ===== -->\n/m);
    const cases = [];
    for (let i = 1; i < parts.length; i += 2) cases.push({ label: parts[i], text: parts[i + 1] });
    return cases;
}

/** Top-level nodes that are not text, as "type:tag" strings. */
const signature = (tree) =>
    tree.children.filter((node) => node.type !== "text").map((node) => `${node.type}:${node.tag || ""}`);

const files = renderFiles();

if (WRITE) {
    fs.mkdirSync(DIR, { recursive: true });
    for (const { name, content } of files) fs.writeFileSync(path.join(DIR, name), content, "utf8");
}

describe("html_samples/", () => {
    it("contains exactly the generated files and the folder README", () => {
        const expected = [...files.map((f) => f.name), "README.md"].sort();
        assert.deepEqual(fs.readdirSync(DIR).sort(), expected);
    });

    it("covers every sample group except the generated stress samples", () => {
        const groups = SAMPLES.map((g) => g.group).filter((g) => g !== STRESS);
        assert.deepEqual(files.map((f) => f.group), groups);
    });

    for (const file of files) {
        describe(file.name, () => {
            it("matches samples.js (run WRITE_HTML_SAMPLES=1 npm test to regenerate)", () => {
                assert.equal(fs.readFileSync(path.join(DIR, file.name), "utf8"), file.content);
            });

            it("parses without internal errors and with a valid tree", (t) => {
                const parse = strictParser(t);
                checkInvariants(parse(fs.readFileSync(path.join(DIR, file.name), "utf8")));
            });

            if (file.group === EDGE) {
                it("starts with a real BOM, which the parser strips", () => {
                    const bytes = fs.readFileSync(path.join(DIR, file.name));
                    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
                    assert.deepEqual(html2json(bytes.toString("utf8")).children, [
                        { type: "element", tag: "p", attributes: {}, children: [{ type: "text", content: "text" }] },
                        { type: "text", content: "   \n\t  " },
                    ]);
                });
                return;
            }

            it("holds every sample of the group, exactly as written in samples.js", () => {
                const onDisk = splitCases(fs.readFileSync(path.join(DIR, file.name), "utf8"));
                const ordered = fileOrder(file.group, file.items);
                assert.deepEqual(
                    onDisk.map((c) => c.label),
                    ordered.map(delimiterLabel)
                );
                onDisk.forEach((c, i) => {
                    assert.ok(c.text.endsWith("\n\n"));
                    assert.equal(c.text.slice(0, -2), ordered[i].html, ordered[i].label);
                });
            });

            if (!(file.group in SEPARATE)) {
                it("is one input in which no sample swallows another", () => {
                    const ordered = fileOrder(file.group, file.items);
                    const expected = ["comment:"]; // the header
                    for (const item of ordered) expected.push("comment:", ...signature(html2json(item.html)));
                    const content = fs.readFileSync(path.join(DIR, file.name), "utf8");
                    assert.deepEqual(signature(html2json(content)), expected);
                });
            }
        });
    }
});