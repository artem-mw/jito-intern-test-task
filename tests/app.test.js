"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { strictParser, checkInvariants } = require("./helpers.js");
const { html2json } = require("../html2json.js");
const { SAMPLES } = require("../samples.js");

// app.js talks to the page through globals and document.getElementById.
// A minimal stub is enough to exercise the conversion glue in Node.
const elements = {
    html: { value: "" },
    json: { value: "" },
    status: { textContent: "" },
    maxDepth: { value: "" },
};
globalThis.document = {
    getElementById: (id) => elements[id],
    addEventListener: () => {},
};
globalThis.html2json = html2json;

const app = require("../app.js");

const el = (tag, children = [], attributes = {}) => ({ type: "element", tag, attributes, children });
const text = (content) => ({ type: "text", content });

describe("app helpers", () => {
    describe("countNodes", () => {
        it("counts every node below the root", () => {
            const tree = { type: "document", children: [el("div", [text("a"), el("b", [text("c")])]), text("d")] };
            assert.equal(app.countNodes(tree), 5);
            assert.equal(app.countNodes({ type: "document", children: [] }), 0);
        });

        it("works on a 100k-deep tree without recursion", () => {
            const result = html2json("<div>".repeat(100_000) + "x");
            assert.equal(app.countNodes(result), 100_001);
        });
    });

    describe("readOptions", () => {
        it("returns no options for empty or invalid values", () => {
            for (const raw of ["", "   ", "abc", "-1", "Infinity", "NaN"]) {
                assert.equal(app.readOptions(raw), undefined, JSON.stringify(raw));
            }
        });

        it("parses valid values", () => {
            assert.deepEqual(app.readOptions("5"), { maxDepth: 5 });
            assert.deepEqual(app.readOptions(" 0 "), { maxDepth: 0 });
            assert.deepEqual(app.readOptions("1e3"), { maxDepth: 1000 });
        });
    });

    describe("serialize", () => {
        it("pretty-prints normal results", () => {
            const result = html2json("<p>a</p>");
            assert.deepEqual(app.serialize(result), {
                text: JSON.stringify(result, null, 2),
                failed: false,
                truncated: false,
                fullLength: JSON.stringify(result, null, 2).length,
            });
        });

        it("reports a too-deep tree instead of throwing", () => {
            const result = html2json("<div>".repeat(50_000) + "x");
            const output = app.serialize(result);
            assert.equal(output.failed, true);
            assert.match(output.text, /nested too deeply/);
            assert.match(output.text, /Max depth/);
        });

        it("reports other serialization errors with their message", () => {
            const output = app.serialize({ toJSON() { throw new Error("boom"); } });
            assert.equal(output.failed, true);
            assert.match(output.text, /boom/);
        });

        it("truncates huge output for display", () => {
            const huge = { type: "document", children: [text("x".repeat(app.MAX_DISPLAY_CHARS + 1000))] };
            const output = app.serialize(huge);
            assert.equal(output.truncated, true);
            assert.ok(output.fullLength > app.MAX_DISPLAY_CHARS);
            assert.ok(output.text.length < app.MAX_DISPLAY_CHARS + 100);
            assert.match(output.text, /truncated for display/);
        });
    });

    describe("formatStatus", () => {
        it("summarizes a normal conversion", () => {
            const status = app.formatStatus({
                inputLength: 1234,
                nodes: 56,
                parseMs: 0.42,
                options: undefined,
                output: { failed: false, truncated: false, fullLength: 10 },
            });
            assert.equal(status, "Input: 1,234 chars \u00b7 Nodes: 56 \u00b7 Parse: 0.4 ms");
        });

        it("mentions maxDepth, failures and truncation", () => {
            const status = app.formatStatus({
                inputLength: 1,
                nodes: 1,
                parseMs: 12.7,
                options: { maxDepth: 100 },
                output: { failed: true, truncated: false, fullLength: 0 },
            });
            assert.match(status, /Parse: 13 ms/);
            assert.match(status, /maxDepth: 100/);
            assert.match(status, /nested too deeply/);

            const truncated = app.formatStatus({
                inputLength: 1,
                nodes: 1,
                parseMs: 1,
                options: undefined,
                output: { failed: false, truncated: true, fullLength: 5_000_000 },
            });
            assert.match(truncated, /first 2,000,000 of 5,000,000 characters/);
        });
    });

    describe("convertHtml2JsonAndSet", () => {
        const convert = (html, maxDepth = "") => {
            elements.html.value = html;
            elements.maxDepth.value = maxDepth;
            app.convertHtml2JsonAndSet();
            return elements;
        };

        it("writes the pretty-printed result and a status line", () => {
            const out = convert("<p>a</p>");
            assert.deepEqual(JSON.parse(out.json.value), html2json("<p>a</p>"));
            assert.match(out.status.textContent, /Input: 8 chars/);
            assert.match(out.status.textContent, /Nodes: 2/);
        });

        it("handles empty input", () => {
            const out = convert("");
            assert.deepEqual(JSON.parse(out.json.value), { type: "document", children: [] });
        });

        it("applies the Max depth field", () => {
            const out = convert("<div><span>x</span></div>", "1");
            assert.deepEqual(
                JSON.parse(out.json.value),
                { type: "document", children: [el("div", [text("<span>x</span></div>")])] }
            );
            assert.match(out.status.textContent, /maxDepth: 1/);
        });

        it("shows a message for a too-deep result and recovers with a limit", () => {
            const html = "<div>".repeat(50_000) + "x";
            assert.match(convert(html).json.value, /nested too deeply/);
            assert.doesNotMatch(convert(html, "100").json.value, /nested too deeply/);
        });
    });
});

describe("samples", () => {
    const flat = app.flattenSamples(SAMPLES);
    const htmlOf = (sample) => (typeof sample.generate === "function" ? sample.generate() : sample.html);
    const find = (fragment) => {
        const sample = flat.find((s) => s.label.includes(fragment));
        assert.ok(sample, `no sample containing "${fragment}"`);
        return sample;
    };

    it("has non-empty groups and unique labels", () => {
        for (const { group, items } of SAMPLES) assert.ok(items.length > 0, group);
        const labels = flat.map((s) => s.label);
        assert.equal(new Set(labels).size, labels.length);
    });

    it("gives every sample either html or generate", () => {
        for (const sample of flat) {
            assert.ok(
                typeof sample.html === "string" || typeof sample.generate === "function",
                sample.label
            );
        }
    });

    it("flattens with the group attached", () => {
        assert.equal(flat[0].group, "Basics");
        assert.equal(flat.length, SAMPLES.reduce((sum, g) => sum + g.items.length, 0));
    });

    it("parses every sample without internal errors and with valid output", (t) => {
        const parse = strictParser(t);
        for (const sample of flat) {
            const options = sample.maxDepth === undefined ? undefined : { maxDepth: sample.maxDepth };
            const result = parse(htmlOf(sample), options);
            checkInvariants(result, sample.maxDepth === undefined ? Infinity : sample.maxDepth);
        }
    });

    it("keeps the stress samples' labels truthful", () => {
        const tooDeep = find("Deep nesting, 50,000 levels (too deep");
        assert.equal(app.serialize(html2json(htmlOf(tooDeep))).failed, true);

        const limited = find("maxDepth 100");
        const limitedOutput = app.serialize(html2json(htmlOf(limited), { maxDepth: limited.maxDepth }));
        assert.equal(limitedOutput.failed, false);
        assert.equal(limitedOutput.truncated, false);

        const large = find("Large flat document");
        assert.equal(app.serialize(html2json(htmlOf(large))).truncated, false);

        const huge = find("Huge document");
        assert.equal(app.serialize(html2json(htmlOf(huge))).truncated, true);
    });
});