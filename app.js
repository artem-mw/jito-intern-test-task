/* global html2json, SAMPLES */

/**
 * Page logic: sample picker, conversion and output display.
 * The pure helpers are exported for the tests.
 */
(function () {
    "use strict";

    /** Largest number of characters shown in the output area. */
    const MAX_DISPLAY_CHARS = 2000000;

    // The output area does not wrap lines (white-space: pre), so keep lines short.
    const TOO_DEEP_MESSAGE = [
        "This result is nested too deeply to be displayed: JSON.stringify",
        "exceeds the engine's call-stack limit. The parser itself handled it.",
        "",
        'Enter a value (for example 1000) in "Max depth" and convert again.',
        "Everything beyond that depth is then kept as text.",
    ].join("\n");

    /* ---------------------------------------------------------------- */
    /* Pure helpers                                                      */
    /* ---------------------------------------------------------------- */

    /** Number of nodes below the root, counted iteratively (no recursion). */
    function countNodes(root) {
        let count = 0;
        const pending = [root];
        while (pending.length > 0) {
            const node = pending.pop();
            if (!node.children) continue;
            for (const child of node.children) {
                count++;
                pending.push(child);
            }
        }
        return count;
    }

    /** Turns the "Max depth" field into parser options (empty or invalid: no limit). */
    function readOptions(raw) {
        const trimmed = String(raw).trim();
        if (trimmed === "") return undefined;
        const maxDepth = Number(trimmed);
        return Number.isFinite(maxDepth) && maxDepth >= 0 ? { maxDepth } : undefined;
    }

    /**
     * Pretty-prints a result for the output area. JSON.stringify is recursive
     * and throws on very deep trees, so that is reported instead of crashing.
     * @returns {{ text: string, failed: boolean, truncated: boolean, fullLength: number }}
     */
    function serialize(result) {
        let json;
        try {
            json = JSON.stringify(result, null, 2);
        } catch (error) {
            const text =
                error instanceof RangeError
                    ? TOO_DEEP_MESSAGE
                    : `The result could not be serialized: ${error.message}`;
            return { text, failed: true, truncated: false, fullLength: 0 };
        }

        if (json.length > MAX_DISPLAY_CHARS) {
            return {
                text: json.slice(0, MAX_DISPLAY_CHARS) + "\n\n... output truncated for display ...",
                failed: false,
                truncated: true,
                fullLength: json.length,
            };
        }
        return { text: json, failed: false, truncated: false, fullLength: json.length };
    }

    function formatNumber(value) {
        return value.toLocaleString("en-US");
    }

    function formatDuration(ms) {
        return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
    }

    /** The one-line status shown next to the Convert button. */
    function formatStatus({ inputLength, nodes, parseMs, options, output }) {
        const parts = [
            `Input: ${formatNumber(inputLength)} chars`,
            `Nodes: ${formatNumber(nodes)}`,
            `Parse: ${formatDuration(parseMs)}`,
        ];
        if (options) parts.push(`maxDepth: ${options.maxDepth}`);
        if (output.failed) parts.push("output not shown (nested too deeply)");
        if (output.truncated) {
            parts.push(
                `showing the first ${formatNumber(MAX_DISPLAY_CHARS)} of ${formatNumber(output.fullLength)} characters`
            );
        }
        return parts.join(" \u00b7 ");
    }

    /** Flattens the grouped samples into one list, each item knowing its group. */
    function flattenSamples(groups) {
        const flat = [];
        for (const { group, items } of groups) {
            for (const item of items) flat.push({ group, ...item });
        }
        return flat;
    }

    /* ---------------------------------------------------------------- */
    /* Page behaviour                                                    */
    /* ---------------------------------------------------------------- */

    const byId = (id) => document.getElementById(id);

    let samples = [];
    let currentIndex = -1; // index of the last loaded sample, -1 before the first

    /** Converts the input textarea to JSON and shows the result. */
    function convertHtml2JsonAndSet() {
        const input = byId("html").value;
        const options = readOptions(byId("maxDepth").value);

        const start = performance.now();
        const result = html2json(input, options);
        const parseMs = performance.now() - start;

        const output = serialize(result);
        byId("json").value = output.text;
        byId("status").textContent = formatStatus({
            inputLength: input.length,
            nodes: countNodes(result),
            parseMs,
            options,
            output,
        });
    }

    function updateNavigation() {
        byId("prev").disabled = currentIndex <= 0;
        byId("next").disabled = currentIndex >= samples.length - 1;
    }

    function loadSample(index) {
        const sample = samples[index];
        byId("html").value = typeof sample.generate === "function" ? sample.generate() : sample.html;
        byId("maxDepth").value = sample.maxDepth === undefined ? "" : String(sample.maxDepth);
        byId("sample").value = String(index);
        currentIndex = index;
        updateNavigation();
        convertHtml2JsonAndSet();
    }

    function fillSampleSelect() {
        const select = byId("sample");

        const custom = document.createElement("option");
        custom.value = "";
        custom.textContent = "Custom input";
        custom.disabled = true;
        select.appendChild(custom);

        let currentGroup = null;
        let optgroup = null;
        samples.forEach((sample, index) => {
            if (sample.group !== currentGroup) {
                optgroup = document.createElement("optgroup");
                optgroup.label = sample.group;
                select.appendChild(optgroup);
                currentGroup = sample.group;
            }
            const option = document.createElement("option");
            option.value = String(index);
            option.textContent = sample.label;
            optgroup.appendChild(option);
        });
    }

    function init() {
        samples = flattenSamples(SAMPLES);
        fillSampleSelect();

        byId("sample").addEventListener("change", (event) => {
            if (event.target.value !== "") loadSample(Number(event.target.value));
        });
        byId("prev").addEventListener("click", () => loadSample(currentIndex - 1));
        byId("next").addEventListener("click", () => loadSample(currentIndex + 1));
        byId("maxDepth").addEventListener("change", convertHtml2JsonAndSet);
        byId("html").addEventListener("input", () => {
            byId("sample").value = ""; // the text no longer matches a sample
        });

        loadSample(0);
    }

    globalThis.convertHtml2JsonAndSet = convertHtml2JsonAndSet;

    if (typeof document !== "undefined") {
        document.addEventListener("DOMContentLoaded", init);
    }

    if (typeof module !== "undefined" && module.exports) {
        module.exports = {
            MAX_DISPLAY_CHARS,
            countNodes,
            readOptions,
            serialize,
            formatStatus,
            flattenSamples,
            convertHtml2JsonAndSet,
        };
    }
})();