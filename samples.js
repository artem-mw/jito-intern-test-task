/**
 * Sample inputs for the page, grouped by category.
 * An item is { label, html } or { label, generate } (for large inputs built on
 * demand). An optional `maxDepth` is put into the "Max depth" field when the
 * sample is loaded.
 */
(function () {
    "use strict";

    const CARD = `<div class="card" id=c1>
  <h2>Title &amp; more</h2>
  <p>Some <b>bold</b> and <i>italic</i> text<br>with a break.</p>
  <!-- a comment -->
  <ul><li>one<li>two<li>three</ul>
  <img src="a.png" alt='x' disabled>
</div>
`;

    const SAMPLES = [
        {
            group: "Basics",
            items: [
                {
                    label: "Task example 1: full document",
                    html: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport">
    <title>Sample HTML</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header>
        <h1>Welcome to My Website</h1>
    </header>
    <nav>
        <ul>
            <li><a href="#home">Home</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="#contact">Contact</a></li>
        </ul>
    </nav>
    <main>
        <section id="home">
            <h2>Home Section</h2>
            <p>This is the home section of the webpage.</p>
        </section>
        <section id="about">
            <h2>About Section</h2>
            <p>This is the about section of the webpage.</p>
        </section>
    </main>
    <footer>
        <p>&copy; 2024 My Website</p>
    </footer>
    <script src="script.js"></script>
</body>
</html>
`,
                },
                {
                    label: "Task example 2: div with textarea",
                    html: `<div>
<p>Hello world!</p>
  <button>Click me!</button>
  <textarea>Some very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very long string.</textarea>
</div>
`,
                },
                { label: "Simple element", html: "<div>content</div>" },
                {
                    label: "Nested elements and text",
                    html: "<div>Hello <b>bold <i>and italic</i></b> world</div>",
                },
                {
                    label: "Multiple top-level nodes",
                    html: "<h1>Title</h1><p>One</p>loose text<p>Two</p>",
                },
                {
                    label: "Whitespace is preserved",
                    html: "<b>a</b> <i>b</i>\n<pre>  keep\n    this  </pre>",
                },
            ],
        },
        {
            group: "Elements",
            items: [
                {
                    label: "Void elements",
                    html: '<p>line<br>break<img src="a.png"><hr><input disabled></p>',
                },
                {
                    label: "Self-closing syntax",
                    html: "<br/><br /><img src=a.png/><div/>text</div>",
                },
                {
                    label: "Tag names are lowercased",
                    html: '<DIV CLASS="Box"><P>Text</P></DIV>',
                },
                { label: "Whitespace inside tags", html: "<div >a</div\n>" },
                {
                    label: "Entities are kept as written",
                    html: '<p title="a &amp; b">&lt;tag&gt; &copy; &#169; &#x41;</p>',
                },
            ],
        },
        {
            group: "Attributes",
            items: [
                {
                    label: "Quote styles",
                    html: `<a href="double" title='single' id=unquoted>link</a>`,
                },
                {
                    label: "Valueless attributes",
                    html: "<input type=checkbox checked disabled>",
                },
                {
                    label: "Duplicates: the first one wins",
                    html: "<div id=first ID=second class=a class=b>x</div>",
                },
                {
                    label: "Spaces around =",
                    html: `<a href = "x" title ='y' id= z>t</a>`,
                },
                {
                    label: "Quoted values containing > and quotes",
                    html: `<a title=">" data-x='say "hi"' data-y="it's">t</a>`,
                },
                { label: "Attributes with no space between them", html: `<a a="1"b="2"c=3>t</a>` },
                {
                    label: "Garbage inside a tag is skipped",
                    html: `<div "x" =foo ='bar' id=1 / class=a>t</div>`,
                },
                {
                    label: "__proto__ and constructor as names",
                    html: `<div __proto__="x" constructor="y" tostring=z>t</div>`,
                },
                { label: "Slash inside an unquoted value", html: "<a href=foo/>link</a>" },
            ],
        },
        {
            group: "Raw text",
            items: [
                {
                    label: "script containing < and >",
                    html: `<script>if (a < b && c > d) { document.write("<p>hi</p>"); }</script>`,
                },
                { label: "style", html: "<style>a > b { color: red; }</style>" },
                {
                    label: "title and textarea",
                    html: "<title>A <b>title</b></title><textarea><b>not bold</b></textarea>",
                },
                {
                    label: "Closing tag is case-insensitive",
                    html: "<script>x</SCRIPT>after",
                },
                {
                    label: "Fake closing tags inside a script",
                    html: "<script>a</scriptx>b</style>c</script>",
                },
                { label: "Empty script", html: "<script></script>" },
                {
                    label: "Self-closing script (the slash is ignored)",
                    html: "<script/>still raw</script>",
                },
            ],
        },
        {
            group: "Foreign content (svg, math)",
            items: [
                {
                    label: "svg with self-closing children",
                    html: `<svg width=10 height=10><path d="M0 0"/><circle r=1 /><g><rect/></g></svg>`,
                },
                {
                    label: "svg title and style are ordinary elements",
                    html: "<svg><title>A <b>bold</b> title</title><style>x</style></svg>",
                },
                {
                    label: "Raw text again after the svg",
                    html: "<svg></svg><title><b>raw</b></title>",
                },
                { label: "MathML", html: "<math><mi>x</mi><mo/><mn>2</mn></math>" },
            ],
        },
        {
            group: "Tree repair",
            items: [
                { label: "Missing closing tags", html: "<div><p>one<span>two" },
                {
                    label: "Mismatched closing tags",
                    html: "<div><span></div>after</span>",
                },
                {
                    label: "Unmatched closing tags",
                    html: "</div>text</span><b>x</b></b>",
                },
                { label: "Unclosed list items", html: "<ul><li>a<li>b<li>c</ul>" },
                {
                    label: "Nested lists keep their nesting",
                    html: "<ul><li>a<ul><li>b</li></ul><li>c</ul>",
                },
                {
                    label: "Paragraphs closed by other blocks",
                    html: "<p>one<p>two<div>block</div><p>three",
                },
                {
                    label: "Table rows and cells",
                    html: "<table><tr><th>h1<th>h2<tr><td>a<td>b<tr><td>c</table>",
                },
                {
                    label: "Definition list",
                    html: "<dl><dt>t1<dd>d1<dt>t2<dd>d2</dl>",
                },
                { label: "Select options", html: "<select><option>a<option>b</select>" },
                {
                    label: "Stray </p> and </br>",
                    html: "before</p>middle</br>after",
                },
                {
                    label: "Known limitation: li inside an inline element",
                    html: "<li>a<b>bold<li>b",
                },
            ],
        },
        {
            group: "Junk and stray brackets",
            items: [
                { label: "<<<div>>>", html: "<<<div>>>" },
                {
                    label: "Comparisons in text",
                    html: "if a < b and c > d then 1 <3 you",
                },
                { label: "Empty and odd tags", html: "<> </> <3 < div> </ div>x" },
                { label: "Non-ASCII after <", html: "<é>text</é>" },
            ],
        },
        {
            group: "Special constructs",
            items: [
                { label: "Comments", html: "<!-- a comment --><p>x</p><!---->" },
                {
                    label: "Degenerate comments",
                    html: "<!--><!---><!----><p>x</p>",
                },
                { label: "Comment ended by --!>", html: "<!-- a --!> b -->" },
                {
                    label: "Markup inside a comment",
                    html: "<!-- <div>x</div> -->after",
                },
                {
                    label: "Doctype variants",
                    html: `<!DOCTYPE html><!doctype HTML PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">`,
                },
                {
                    label: "CDATA, processing instructions, bogus (dropped)",
                    html: `a<![CDATA[ x > y ]]>b<?xml version="1.0"?>c<!foo>d`,
                },
            ],
        },
        {
            group: "Truncated input",
            items: [
                { label: "Unfinished opening tag", html: `<p>text</p><div class="a` },
                { label: "Unfinished closing tag", html: "<p>text</p" },
                { label: "Unterminated comment", html: "<p>x</p><!-- never closed" },
                { label: "Unterminated doctype", html: "<!DOCTYPE html" },
                { label: "Unterminated script", html: "<script>var a = 1; if (a < 2) {" },
                { label: "Unterminated CDATA", html: "text<![CDATA[ never closed" },
                { label: "Lone < at the end", html: "a < b <" },
                { label: "Elements still open at the end", html: "<div><section><p>deep" },
            ],
        },
        {
            group: "Input edge cases",
            items: [
                { label: "Empty input", html: "" },
                { label: "Whitespace only", html: "   \n\t  " },
                { label: "Leading BOM (stripped)", html: "\uFEFF<p>text</p>" },
            ],
        },
        {
            group: "maxDepth option",
            items: [
                {
                    label: "maxDepth 2: the rest becomes text",
                    html: "<div><section><p><span>x</span></p></section></div>",
                    maxDepth: 2,
                },
                {
                    label: "maxDepth 1: text before the limit is merged",
                    html: "<div>abc<span>x</span></div>",
                    maxDepth: 1,
                },
                {
                    label: "maxDepth 0: void elements still pass",
                    html: "<br>text<img><p>a</p>",
                    maxDepth: 0,
                },
            ],
        },
        {
            group: "Stress (generated)",
            items: [
                {
                    label: "Deep nesting, 50,000 levels (too deep to display)",
                    generate: () => "<div>".repeat(50000) + "x" + "</div>".repeat(50000),
                },
                {
                    label: "Deep nesting, 50,000 levels, maxDepth 100",
                    generate: () => "<div>".repeat(50000) + "x" + "</div>".repeat(50000),
                    maxDepth: 100,
                },
                {
                    label: "Large flat document (about 100 KB)",
                    generate: () => CARD.repeat(Math.ceil(100000 / CARD.length)),
                },
                {
                    label: "Huge document (about 1.5 MB, output truncated for display)",
                    generate: () => CARD.repeat(Math.ceil(1500000 / CARD.length)),
                },
                {
                    label: "5,000 list items without closing tags",
                    generate: () => "<ul>" + "<li>item".repeat(5000) + "</ul>",
                },
                {
                    label: "5,000 attributes on one tag",
                    generate: () => {
                        let html = "<div";
                        for (let i = 0; i < 5000; i++) html += ` a${i}=${i}`;
                        return html + ">x</div>";
                    },
                },
                {
                    label: "100,000 stray closing tags",
                    generate: () => "</span>".repeat(100000),
                },
            ],
        },
    ];

    if (typeof module !== "undefined" && module.exports) {
        module.exports = { SAMPLES };
    } else {
        globalThis.SAMPLES = SAMPLES;
    }
})();