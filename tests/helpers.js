"use strict";

/** Helpers shared by the test files. */

const assert = require("node:assert/strict");
const { html2json } = require("../html2json.js");

const VOID = new Set([
    "area", "base", "br", "col", "embed", "hr", "img",
    "input", "link", "meta", "source", "track", "wbr",
]);

/** A parse function that fails the test if html2json logged an internal error. */
function strictParser(t) {
    const spy = t.mock.method(console, "error", () => {});
    return (html, options) => {
        const before = spy.mock.callCount();
        const result = html2json(html, options);
        if (spy.mock.callCount() !== before) {
            assert.fail(
                `html2json hit its safety net for input ${JSON.stringify(html).slice(0, 300)} ` +
                `with options ${JSON.stringify(options)}`
            );
        }
        return result;
    };
}

/**
 * Checks the output contract on any result, iteratively (no recursion, so
 * it works on very deep trees).
 *  - exact node shapes and key order
 *  - lowercase tags, string-only attribute values, normal prototypes
 *  - no empty text nodes, no adjacent text nodes
 *  - void elements have no children
 *  - with maxDepth: elements with children are at most maxDepth deep, and
 *    childless leaf elements at most maxDepth + 1
 */
function checkInvariants(root, maxDepth = Infinity) {
    assert.deepEqual(Object.keys(root), ["type", "children"]);
    assert.equal(root.type, "document");

    const pending = [[root, 0]];
    while (pending.length > 0) {
        const [node, depth] = pending.pop();
        assert.ok(Array.isArray(node.children), "children must be an array");

        let previous = null;
        for (const child of node.children) {
            switch (child.type) {
                case "element": {
                    assert.deepEqual(Object.keys(child), ["type", "tag", "attributes", "children"]);
                    assert.equal(typeof child.tag, "string");
                    assert.ok(child.tag.length > 0, "empty tag name");
                    assert.ok(!/[A-Z]/.test(child.tag), `tag not lowercased: ${child.tag}`);
                    assert.equal(Object.getPrototypeOf(child.attributes), Object.prototype);
                    for (const value of Object.values(child.attributes)) {
                        assert.equal(typeof value, "string");
                    }
                    if (VOID.has(child.tag)) assert.equal(child.children.length, 0, child.tag);

                    const childDepth = depth + 1;
                    assert.ok(childDepth <= maxDepth + 1, `depth ${childDepth} exceeds maxDepth + 1`);
                    if (child.children.length > 0) {
                        assert.ok(childDepth <= maxDepth, `element with children at depth ${childDepth}`);
                    }
                    pending.push([child, childDepth]);
                    break;
                }
                case "text":
                    assert.deepEqual(Object.keys(child), ["type", "content"]);
                    assert.equal(typeof child.content, "string");
                    assert.notEqual(child.content, "", "empty text node");
                    assert.notEqual(previous, "text", "adjacent text nodes");
                    break;
                case "comment":
                case "doctype":
                    assert.deepEqual(Object.keys(child), ["type", "content"]);
                    assert.equal(typeof child.content, "string");
                    break;
                default:
                    assert.fail(`unknown node type: ${child.type}`);
            }
            previous = child.type;
        }
    }
}

module.exports = { strictParser, checkInvariants };