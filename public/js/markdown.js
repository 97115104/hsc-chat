const Markdown = (() => {
  if (typeof marked !== "undefined") {
    marked.setOptions({
      gfm: true,
      breaks: true,
      headerIds: false,
      mangle: false,
    });
  }

  function render(text) {
    if (!text || typeof marked === "undefined" || typeof DOMPurify === "undefined") {
      return "";
    }
    const raw = marked.parse(text);
    return DOMPurify.sanitize(raw, {
      ADD_ATTR: ["target", "rel"],
      ALLOWED_TAGS: [
        "p", "br", "strong", "em", "b", "i", "u", "s", "del",
        "h1", "h2", "h3", "h4", "h5", "h6",
        "ul", "ol", "li",
        "blockquote", "pre", "code", "hr",
        "a", "table", "thead", "tbody", "tr", "th", "td",
        "span", "div",
      ],
    });
  }

  function setBody(el, text, { streaming = false } = {}) {
    if (!el) return;
    if (streaming || !text) {
      el.classList.remove("markdown-body");
      el.textContent = text || "";
      return;
    }
    el.classList.add("markdown-body");
    el.innerHTML = render(text);
    el.querySelectorAll("a[href]").forEach((a) => {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });
  }

  return { render, setBody };
})();

window.Markdown = Markdown;
