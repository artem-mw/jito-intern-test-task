/**
 * html2json: converts an HTML string into a JSON tree without a DOM parser.
 *
 * A single pass over the string (the tokenizer) reports tokens to a tree
 * builder that keeps an explicit stack of open elements, so there is no
 * recursion. README.md describes the output format, the parsing rules and the
 * design.
 */
(function () {
    "use strict";

    /* ------------------------------------------------------------------ */
    /* Constants                                                           */
    /* ------------------------------------------------------------------ */

    const BOM = "\uFEFF";
    const DOCTYPE_KEYWORD = "doctype";
    const CDATA_OPEN = "[CDATA[";
    const CDATA_CLOSE = "]]>";

    // Character codes.
    const CHAR_BANG = 0x21; // "!"
    const CHAR_DQUOTE = 0x22; // '"'
    const CHAR_SQUOTE = 0x27; // "'"
    const CHAR_DASH = 0x2d; // "-"
    const CHAR_SLASH = 0x2f; // "/"
    const CHAR_EQ = 0x3d; // "="
    const CHAR_GT = 0x3e; // ">"
    const CHAR_QUESTION = 0x3f; // "?"

    // What a "<" can start (see classify).
    const LITERAL = 0; // not markup: the "<" is plain text
    const START_TAG = 1;
    const END_TAG = 2;
    const DECLARATION = 3; // "<!": comment, doctype, CDATA or bogus
    const BOGUS = 4; // "<?" and "</" + non-letter: dropped through ">"

    // Signals the builder returns to the tokenizer after a start tag.
    const CONTINUE = 0;
    const ENTER_RAW_TEXT = 1; // the tokenizer must now read the element's raw text
    const STOP = 2; // maxDepth reached: the builder consumed the rest of the input as text

    const VOID = new Set([
        "area", "base", "br", "col", "embed", "hr", "img",
        "input", "link", "meta", "source", "track", "wbr",
    ]);

    /** Content of these elements is plain text, not markup (outside svg/math). */
    const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

    /** Foreign-content roots: inside them "/>" self-closes and RAW_TEXT does not apply. */
    const FOREIGN = new Set(["svg", "math"]);

    /** Block-level tags that implicitly close an open <p>. */
    const BLOCK = [
        "address", "article", "aside", "blockquote", "div", "dl", "fieldset",
        "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
        "main", "nav", "ol", "pre", "section", "table", "ul",
    ];

    /**
     * Optional end tags (a small subset of the HTML rules). For an incoming
     * start tag: an ordered list of tag-name sets; for each set in turn, if the
     * element on top of the stack is in it, that element is closed first.
     * Only the top of the stack is checked, so legitimate nesting such as
     * <li><ul><li> is kept.
     */
    const AUTO_CLOSE = (() => {
        const p = new Set(["p"]);
        const cell = new Set(["td", "th"]);
        const definition = new Set(["dt", "dd"]);
        const rules = new Map([
            ["li", [new Set(["li"])]],
            ["dt", [definition]],
            ["dd", [definition]],
            ["option", [new Set(["option"])]],
            ["td", [cell]],
            ["th", [cell]],
            ["tr", [cell, new Set(["tr"])]],
            ["p", [p]],
        ]);
        for (const name of BLOCK) rules.set(name, [p]);
        return rules;
    })();

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    /** Creates an empty synthetic root node. */
    function createDocument() {
        return { type: "document", children: [] };
    }

    /** Creates an element node. */
    function createElement(tag, attributes) {
        return { type: "element", tag, attributes, children: [] };
    }

    /** Whitespace inside tags: space, tab, LF, FF (CR is normalized away). */
    function isWhitespace(code) {
        return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c;
    }

    /** Characters that end a tag name (and, together with "=", an attribute name). */
    function isNameEnd(code) {
        return isWhitespace(code) || code === CHAR_SLASH || code === CHAR_GT;
    }

    function isAsciiUpper(code) {
        return code >= 0x41 && code <= 0x5a;
    }

    function isAsciiLetter(code) {
        return isAsciiUpper(code) || (code >= 0x61 && code <= 0x7a);
    }

    /** ASCII-only lowercase of one character code. */
    function lowerAsciiCode(code) {
        return isAsciiUpper(code) ? code + 0x20 : code;
    }

    /** ASCII-only lowercasing (String#toLowerCase can change length for some non-ASCII). */
    function lowerAscii(str) {
        return str.replace(/[A-Z]+/g, (match) => match.toLowerCase());
    }

    /* ------------------------------------------------------------------ */
    /* Preprocessing and options                                           */
    /* ------------------------------------------------------------------ */

    /** Strips a single leading BOM and normalizes \r\n and lone \r to \n. */
    function preprocess(input) {
        let source = input.startsWith(BOM) ? input.slice(BOM.length) : input;
        if (source.indexOf("\r") !== -1) {
            source = source.replace(/\r\n?/g, "\n");
        }
        return source;
    }

    /** Returns a usable maxDepth; anything invalid falls back to Infinity (no limit). */
    function resolveMaxDepth(options) {
        if (options === null || typeof options !== "object") return Infinity;
        const { maxDepth } = options;
        if (typeof maxDepth !== "number" || Number.isNaN(maxDepth) || maxDepth < 0) {
            return Infinity;
        }
        return maxDepth;
    }

    /* ------------------------------------------------------------------ */
    /* Tree builder                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Owns all tree state: the root document node, the stack of open elements and a
     * counter map (tag name -> number of that name currently open), which makes
     * "is there anything to close?" an O(1) check. `foreignOpen` counts open
     * svg/math elements, for the foreign-content rules. Depth is the number of
     * open elements, not counting the document.
     */
    function createBuilder(source, maxDepth) {
        const root = createDocument();
        const stack = [root];
        const counts = new Map();
        let foreignOpen = 0;

        /** The element on top of the stack: the parent of whatever is appended next. */
        function current() {
            return stack[stack.length - 1];
        }

        /** The number of open elements, not counting the root. */
        function depth() {
            return stack.length - 1;
        }

        /** Opens an element. All pushes and pops use push() and pop(), so the counters cannot drift. */
        function push(element) {
            stack.push(element);
            counts.set(element.tag, (counts.get(element.tag) || 0) + 1);
            if (FOREIGN.has(element.tag)) foreignOpen++;
        }

        /** Closes the element on top of the stack and returns it. */
        function pop() {
            const element = stack.pop();
            const count = counts.get(element.tag);
            if (count === 1) counts.delete(element.tag);
            else counts.set(element.tag, count - 1);
            if (FOREIGN.has(element.tag)) foreignOpen--;
            return element;
        }

        /** Appends text to the current parent, merging with a preceding text node. */
        function text(content) {
            if (content === "") return;
            const children = current().children;
            const last = children[children.length - 1];
            if (last !== undefined && last.type === "text") {
                last.content += content;
            } else {
                children.push({ type: "text", content });
            }
        }

        /** Appends a comment node to the current parent. */
        function comment(content) {
            current().children.push({ type: "comment", content });
        }

        /** Appends a doctype node to the current parent. */
        function doctype(content) {
            current().children.push({ type: "doctype", content });
        }

        /** Appends an element with no attributes and no children (for </br> and a stray </p>). */
        function appendEmptyElement(name) {
            current().children.push(createElement(name, {}));
        }

        /** Applies the optional-end-tag rules (AUTO_CLOSE) for an incoming start tag. */
        function autoClose(name) {
            const rules = AUTO_CLOSE.get(name);
            if (rules === undefined) return;
            for (const closable of rules) {
                if (closable.has(current().tag)) pop(); // the root has no tag, so it is never popped
            }
        }

        /**
         * Appends an element and pushes it unless it cannot have children: void
         * elements, and "/>" on svg/math or anything inside them. Elsewhere, "/>"
         * is ignored, as in HTML, so <div/> opens a div.
         *
         * If the element was pushed beyond maxDepth, parsing stops instead:
         * everything from the tag's "<" (`lt`, its offset in the source) to EOF is
         * appended as text to the current parent.
         *
         * @returns {number} CONTINUE, ENTER_RAW_TEXT or STOP
         */
        function startTag(name, attributes, selfClosing, lt) {
            autoClose(name);

            const isLeaf =
                VOID.has(name) || (selfClosing && (foreignOpen > 0 || FOREIGN.has(name)));

            if (!isLeaf && depth() >= maxDepth) {
                text(source.slice(lt));
                return STOP;
            }

            const element = createElement(name, attributes);
            current().children.push(element);
            if (isLeaf) return CONTINUE;

            push(element);
            return foreignOpen === 0 && RAW_TEXT.has(name) ? ENTER_RAW_TEXT : CONTINUE;
        }

        /**
         * Closes the nearest open element with this name, and everything opened
         * after it. Stray closing tags are ignored, with two exceptions that
         * follow browsers: </br> acts as <br>, and a stray </p> creates an empty p.
         */
        function endTag(name) {
            if (name === "br") {
                appendEmptyElement("br");
                return;
            }
            // Other void elements have no content, so their end tags mean nothing.
            if (VOID.has(name)) return;

            if (!counts.has(name)) {
                // Nothing is open under this name, so there is nothing to close (an O(1) check).
                if (name === "p") appendEmptyElement("p");
                return;
            }

            // A match is guaranteed, so pop until it has been popped.
            let element;
            do {
                element = pop();
            } while (element.tag !== name);
        }

        return { root, text, comment, doctype, startTag, endTag };
    }

    /* ------------------------------------------------------------------ */
    /* Tokenizer                                                           */
    /* ------------------------------------------------------------------ */

    /**
     * Stores an attribute. The first occurrence of a name wins. Names are
     * already lowercased, so "ID" and "id" collide. A "__proto__" attribute is
     * defined as an ordinary own property, because plain assignment would hit
     * the Object.prototype setter. Pass null to discard (closing tags).
     */
    function recordAttribute(attributes, name, value) {
        if (attributes === null || Object.hasOwn(attributes, name)) return;
        if (name === "__proto__") {
            Object.defineProperty(attributes, name, {
                value,
                writable: true,
                enumerable: true,
                configurable: true,
            });
        } else {
            attributes[name] = value;
        }
    }

    /** Position of the quote that closes the quote at `quotePos`, or -1 if there is none. */
    function findClosingQuote(source, quotePos) {
        const quote = source.charCodeAt(quotePos) === CHAR_DQUOTE ? '"' : "'";
        return source.indexOf(quote, quotePos + 1);
    }

    /** Position of the first whitespace or ">" at or after `pos`, or the input length. */
    function findUnquotedEnd(source, pos) {
        const length = source.length;
        while (pos < length) {
            const code = source.charCodeAt(pos);
            if (isWhitespace(code) || code === CHAR_GT) break;
            pos++;
        }
        return pos;
    }

    /**
     * Skips one unparseable token inside a tag and returns the position after it
     * (or -1 if a quote is never closed). The token is any run of "=", then
     * either a quoted string or a run-up to whitespace or ">".
     * Called only when the current character is "=" or a quote, so it always
     * consumes at least one character.
     */
    function skipGarbage(source, pos) {
        while (source.charCodeAt(pos) === CHAR_EQ) pos++;

        const code = source.charCodeAt(pos);
        if (code === CHAR_DQUOTE || code === CHAR_SQUOTE) {
            const close = findClosingQuote(source, pos);
            return close === -1 ? -1 : close + 1;
        }
        return findUnquotedEnd(source, pos);
    }

    /**
     * Reads the inside of a tag, starting just after the tag name, up to and
     * including the closing ">". Attributes are recorded into `attributes`
     * (null for closing tags: the same machine runs so that a ">" inside a
     * quoted value is not mistaken for the end of the tag).
     *
     * States: BEFORE_NAME -> ATTR_NAME -> AFTER_NAME -> BEFORE_VALUE ->
     * QUOTED | UNQUOTED -> BEFORE_NAME.
     *
     * `tagFlags.selfClosing` is set when the tag ends with "/>" (a "/" inside an
     * unquoted value does not count).
     *
     * @returns {number} the position after ">", or -1 if the input ends first
     */
    function readTagBody(source, pos, attributes, tagFlags) {
        const length = source.length;
        tagFlags.selfClosing = false;

        while (pos < length) {
            // BEFORE_NAME
            let code = source.charCodeAt(pos);
            if (isWhitespace(code)) {
                pos++;
                continue;
            }
            if (code === CHAR_SLASH) {
                if (source.charCodeAt(pos + 1) === CHAR_GT) {
                    tagFlags.selfClosing = true;
                    return pos + 2;
                }
                pos++; // stray slash
                continue;
            }
            if (code === CHAR_GT) return pos + 1;
            if (code === CHAR_EQ || code === CHAR_DQUOTE || code === CHAR_SQUOTE) {
                pos = skipGarbage(source, pos);
                if (pos === -1) return -1;
                continue;
            }

            // ATTR_NAME
            const nameStart = pos++;
            while (pos < length) {
                code = source.charCodeAt(pos);
                if (isNameEnd(code) || code === CHAR_EQ) break;
                pos++;
            }
            const name = lowerAscii(source.slice(nameStart, pos));

            // AFTER_NAME
            while (pos < length && isWhitespace(source.charCodeAt(pos))) pos++;
            if (source.charCodeAt(pos) !== CHAR_EQ) {
                recordAttribute(attributes, name, "");
                continue;
            }
            pos++; // consume "="

            // BEFORE_VALUE
            while (pos < length && isWhitespace(source.charCodeAt(pos))) pos++;
            if (pos >= length) return -1;
            code = source.charCodeAt(pos);

            if (code === CHAR_GT) {
                recordAttribute(attributes, name, "");
                return pos + 1;
            }

            if (code === CHAR_DQUOTE || code === CHAR_SQUOTE) {
                // QUOTED
                const close = findClosingQuote(source, pos);
                if (close === -1) return -1;
                recordAttribute(attributes, name, source.slice(pos + 1, close));
                pos = close + 1;
            } else {
                // UNQUOTED: a "/" belongs to the value
                const valueEnd = findUnquotedEnd(source, pos);
                recordAttribute(attributes, name, source.slice(pos, valueEnd));
                pos = valueEnd;
            }
        }

        return -1;
    }

    /**
     * True if "</" at `lt` is followed by `name` (lowercase), compared
     * case-insensitively, and then by whitespace, "/" or ">".
     */
    function isRawTextEnd(source, lt, name) {
        const nameStart = lt + 2;
        for (let i = 0; i < name.length; i++) {
            if (lowerAsciiCode(source.charCodeAt(nameStart + i)) !== name.charCodeAt(i)) return false;
        }
        const after = source.charCodeAt(nameStart + name.length);
        return isWhitespace(after) || after === CHAR_SLASH || after === CHAR_GT;
    }

    /**
     * Reads the content of a raw-text element (script, style, textarea, title)
     * as a single text node, up to its closing tag or EOF. The closing tag
     * itself is left for the normal tag path, so the returned position is at "</".
     * @returns {number} the position of the terminator, or the input length
     */
    function readRawText(source, start, name, builder) {
        let lt = source.indexOf("</", start);
        while (lt !== -1 && !isRawTextEnd(source, lt, name)) {
            lt = source.indexOf("</", lt + 1);
        }
        const end = lt === -1 ? source.length : lt;
        if (end > start) builder.text(source.slice(start, end));
        return end;
    }

    /**
     * Reads a start or end tag beginning at `lt` and reports it to the builder.
     * A start tag that opens a raw-text element also consumes that element's
     * content, and one that hits maxDepth consumes the rest of the input.
     * @returns {number} the position after what was consumed, or -1 if the tag is unfinished
     */
    function readTag(source, lt, isEnd, builder, tagFlags) {
        const length = source.length;
        const nameStart = isEnd ? lt + 2 : lt + 1;
        let nameEnd = nameStart + 1; // the first character is known to be a letter
        while (nameEnd < length) {
            if (isNameEnd(source.charCodeAt(nameEnd))) break;
            nameEnd++;
        }

        const attributes = isEnd ? null : {};
        const end = readTagBody(source, nameEnd, attributes, tagFlags);
        if (end === -1) return -1;

        const name = lowerAscii(source.slice(nameStart, nameEnd));
        if (isEnd) {
            builder.endTag(name);
            return end;
        }
        const signal = builder.startTag(name, attributes, tagFlags.selfClosing, lt);
        if (signal === STOP) return source.length; // the builder took the rest as text
        return signal === ENTER_RAW_TEXT ? readRawText(source, end, name, builder) : end;
    }

    /**
     * Skips a bogus construct through the next ">".
     * @returns {number} the position after ">", or -1 if there is none
     */
    function skipBogus(source, start) {
        const gt = source.indexOf(">", start);
        return gt === -1 ? -1 : gt + 1;
    }

    /**
     * Reads a comment whose content starts at `start` (just after "<!--").
     * It ends at the first "-->" or "--!>". "<!-->" and "<!--->" are empty
     * comments. An unterminated comment is kept, with content to EOF.
     * @returns {number} the position after the comment
     */
    function readComment(source, start, builder) {
        const first = source.charCodeAt(start);
        if (first === CHAR_GT) {
            builder.comment("");
            return start + 1;
        }
        if (first === CHAR_DASH && source.charCodeAt(start + 1) === CHAR_GT) {
            builder.comment("");
            return start + 2;
        }

        // Resume from dashes + 1 (not + 2) so that "--->" is found.
        let dashes = source.indexOf("--", start);
        while (dashes !== -1) {
            const after = source.charCodeAt(dashes + 2);
            if (after === CHAR_GT) {
                builder.comment(source.slice(start, dashes));
                return dashes + 3;
            }
            if (after === CHAR_BANG && source.charCodeAt(dashes + 3) === CHAR_GT) {
                builder.comment(source.slice(start, dashes));
                return dashes + 4;
            }
            dashes = source.indexOf("--", dashes + 1);
        }

        builder.comment(source.slice(start));
        return source.length;
    }

    /**
     * Reads a doctype whose content starts at `start` (just after "<!doctype").
     * The content runs to the first ">" or EOF and is trimmed. An unterminated
     * doctype is kept.
     * @returns {number} the position after the doctype
     */
    function readDoctype(source, start, builder) {
        const gt = source.indexOf(">", start);
        if (gt === -1) {
            builder.doctype(source.slice(start).trim());
            return source.length;
        }
        builder.doctype(source.slice(start, gt).trim());
        return gt + 1;
    }

    /**
     * Handles "<!": comment, doctype (case-insensitive), CDATA (dropped through"]]>") or anything else (bogus, dropped through ">").
     * @returns {number} the position after the construct, or -1 if unfinished and dropped
     */
    function readDeclaration(source, lt, builder) {
        const afterBang = lt + 2;

        if (source.startsWith("--", afterBang)) {
            return readComment(source, afterBang + 2, builder);
        }

        const doctypeEnd = afterBang + DOCTYPE_KEYWORD.length;
        if (lowerAscii(source.slice(afterBang, doctypeEnd)) === DOCTYPE_KEYWORD) {
            return readDoctype(source, doctypeEnd, builder);
        }

        if (source.startsWith(CDATA_OPEN, afterBang)) {
            const close = source.indexOf(CDATA_CLOSE, afterBang + CDATA_OPEN.length);
            return close === -1 ? -1 : close + CDATA_CLOSE.length;
        }

        return skipBogus(source, afterBang);
    }

    /** Decides what the "<" at `lt` starts. Looks ahead only, consumes nothing. */
    function classify(source, lt) {
        const next = source.charCodeAt(lt + 1);
        if (isAsciiLetter(next)) return START_TAG;
        if (next === CHAR_SLASH) {
            if (isAsciiLetter(source.charCodeAt(lt + 2))) return END_TAG;
            return lt + 2 < source.length ? BOGUS : LITERAL; // a lone "</" at EOF is text
        }
        if (next === CHAR_BANG) return DECLARATION;
        if (next === CHAR_QUESTION) return BOGUS;
        return LITERAL;
    }

    /**
     * Scans the source and reports tokens to the builder.
     *
     * DATA state: jump to the next "<" with indexOf and classify it. A "<" that
     * starts no construct stays in the text run. Otherwise, the pending text is
     * flushed (so text before a dropped construct is never lost) and the
     * construct is read. Each reader returns the position after the construct,
     * or -1 if it was unfinished at EOF and is dropped along with the rest of
     * the input.
     */
    function tokenize(source, builder) {
        const length = source.length;
        const tagFlags = { selfClosing: false }; // filled in by readTagBody for every tag
        let textStart = 0; // start of the pending text run
        let pos = 0;

        while (pos < length) {
            const lt = source.indexOf("<", pos);
            if (lt === -1) break;

            const kind = classify(source, lt);
            if (kind === LITERAL) {
                pos = lt + 1; // literal "<", stays in the text run
                continue;
            }

            if (lt > textStart) builder.text(source.slice(textStart, lt));

            let end;
            if (kind === START_TAG || kind === END_TAG) {
                end = readTag(source, lt, kind === END_TAG, builder, tagFlags);
            } else if (kind === DECLARATION) {
                end = readDeclaration(source, lt, builder);
            } else {
                // BOGUS: "<?" and "</" + non-letter both open with two characters.
                end = skipBogus(source, lt + 2);
            }

            if (end === -1) {
                textStart = pos = length;
                break;
            }
            textStart = pos = end;
        }

        if (textStart < length) builder.text(source.slice(textStart));
    }

    /* ------------------------------------------------------------------ */
    /* Public API                                                          */
    /* ------------------------------------------------------------------ */

    /**
     * Converts an HTML string into a JSON-compatible tree.
     * Never throws: on an internal error it logs the error and returns an empty document.
     *
     * @param {string} htmlText
     * @param {{ maxDepth?: number }} [options] maxDepth (default Infinity): an
     *   element that would be nested deeper than this is not parsed; the rest of
     *   the input, from that tag on, is kept as one text node.
     * @returns {{ type: "document", children: object[] }}
     */
    function html2json(htmlText, options) {
        try {
            if (typeof htmlText !== "string") return createDocument();

            const source = preprocess(htmlText);
            const maxDepth = resolveMaxDepth(options);
            const builder = createBuilder(source, maxDepth);

            tokenize(source, builder);
            return builder.root;
        } catch (error) {
            console.error("html2json failed:", error);
            return createDocument();
        }
    }

    if (typeof module !== "undefined" && module.exports) {
        module.exports = { html2json };
    } else {
        globalThis.html2json = html2json;
    }
})();