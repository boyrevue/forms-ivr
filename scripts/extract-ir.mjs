// extract-ir.mjs
// Node 18+ (ESM). Requires: npm i -D playwright
import { writeFile, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url && !args.file) {
    console.error(
      "Usage:\n  node extract-ir.mjs --url <https://...> --out ir.json\n  node extract-ir.mjs --file <local.html> --out ir.json"
    );
    process.exit(1);
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  if (args.url) {
    await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: args.timeout });
  } else {
    const html = await readFile(resolve(args.file), "utf8");
    await page.setContent(html, { waitUntil: "load" });
  }

  if (args.wait) {
    try { await page.waitForSelector(args.wait, { timeout: args.timeout }); } catch {}
  }

  const fields = await page.evaluate(() => {
    // ================= UTILITIES =================
    const STOP_ANSWERS = new Set([
      "yes","no","true","false","please select","select from more options",
      "other","other options","none","n a","na","unknown","on","off",
      "agree","disagree","male","female","prefer not to say","not applicable"
    ]);

    const QUESTION_WRAPPER_SEL = [
      ".question-instance", ".mint-question", ".form-group", ".field",
      ".question", ".question-row", ".control-row", "[data-question]",
      "[role='group']", "[role='radiogroup']"
    ].join(",");

    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const normAlpha = (s) => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    const tokenCount = (s) => (s ? s.trim().split(/\s+/).filter(Boolean).length : 0);
    const isElement = (n) => n && n.nodeType === 1;

    const isVisible = (el) => {
      if (!isElement(el)) return false;
      if (el.hasAttribute("hidden")) return false;
      const st = getComputedStyle(el);
      if (!st || st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
      const r = el.getBoundingClientRect();
      return !!r && r.width >= 1 && r.height >= 1;
    };

    const textOf = (el) => {
      if (!isElement(el)) return "";
      const clone = el.cloneNode(true);
      clone.querySelectorAll("script,style,svg,input,select,textarea,button").forEach((n) => n.remove());
      const aria = clone.getAttribute("aria-label") || "";
      return norm(aria || clone.textContent || "");
    };

    const cssPath = (el) => {
      if (!isElement(el)) return "";
      if (el.id) return `#${CSS.escape(el.id)}`;
      const segs = [];
      let n = el;
      while (n && isElement(n) && n !== document.documentElement) {
        let sel = n.nodeName.toLowerCase();
        if (n.id) {
          segs.unshift(`#${CSS.escape(n.id)}`);
          break;
        } else {
          const parent = n.parentElement;
          if (!parent) { segs.unshift(sel); break; }
          const idx = Array.prototype.indexOf.call(parent.children, n) + 1;
          sel += `:nth-child(${idx})`;
          segs.unshift(sel);
          n = parent;
        }
      }
      return segs.join(" > ");
    };

    const relativeCss = (container, el) => {
      if (!container || !el) return "";
      if (el === container) return ":scope";
      const segs = [];
      let n = el;
      while (n && n !== container && n !== document.body) {
        const p = n.parentElement;
        if (!p) break;
        const tag = n.tagName.toLowerCase();
        const sibs = Array.from(p.children).filter((c) => c.tagName === n.tagName);
        const idx = sibs.indexOf(n) + 1;
        segs.unshift(`${tag}:nth-of-type(${idx})`);
        n = p;
      }
      return `:scope > ${segs.join(" > ")}`;
    };

    const shortLocator = (el, container) => {
      if (!el) return null;
      const id = el.getAttribute("id");
      if (id) return `#${CSS.escape(id)}`;
      const name = el.getAttribute("name");
      if (name) return `${cssPath(container)} ${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
      return `${cssPath(container)} ${relativeCss(container, el)}`;
    };

    const hash32 = (s) => {
      s = s || "";
      let h = 2166136261 >>> 0;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return ("00000000" + (h >>> 0).toString(16)).slice(-8);
    };

    const buildContainerKey = (container, question) => "c:" + hash32(cssPath(container) + "|" + norm(question));

    const minMaxOf = (el) => {
      const minA = el.getAttribute("min");
      const maxA = el.getAttribute("max");
      const min = minA !== null && minA !== "" ? (isNaN(+minA) ? minA : +minA) : null;
      const max = maxA !== null && maxA !== "" ? (isNaN(+maxA) ? maxA : +maxA) : null;
      return { min, max };
    };

    // ============= BETTER CONTAINER PICKER =============
    // For radios/checkboxes: find the smallest ancestor that contains the WHOLE same-name group.
    function smallestAncestorContainingAll(node, groupEls) {
      const chain = [];
      let n = node;
      while (n && n !== document.body) { chain.push(n); n = n.parentElement; }
      for (const anc of chain) {
        if (/^(label|span|em|strong)$/i.test(anc.tagName)) continue;
        if (groupEls.every((g) => anc.contains(g))) return anc;
      }
      return node.parentElement || node;
    }

    function findQuestionContainer(control) {
      const tag = control.tagName.toLowerCase();
      const type = (control.getAttribute("type") || "").toLowerCase();

      // 1) Closest explicit wrapper (best case)
      const explicit = control.closest(QUESTION_WRAPPER_SEL);
      if (explicit) return explicit;

      // 2) Radio/checkbox — bind to the group wrapper
      if (tag === "input" && (type === "radio" || type === "checkbox")) {
        const name = control.getAttribute("name");
        if (name) {
          const groupEls = Array.from(document.querySelectorAll(`input[type="${type}"][name="${CSS.escape(name)}"]`))
            .filter(isVisible);
          if (groupEls.length > 1) {
            const anc = smallestAncestorContainingAll(control, groupEls);
            const better = anc.closest(QUESTION_WRAPPER_SEL) || anc;
            return better;
          }
        }
      }

      // 3) Walk up to a sensible block with a small number of controls
      let node = control;
      let best = null, bestScore = -1;
      while (node && node !== document.body) {
        if (!isElement(node)) { node = node.parentElement; continue; }
        const controls = node.querySelectorAll("input,select,textarea");
        if (controls.length === 0 || controls.length > 14) { node = node.parentElement; continue; }

        let score = 0;
        if (node.matches(QUESTION_WRAPPER_SEL)) score += 30;
        const rect = node.getBoundingClientRect();
        if (rect.height < 500) score += 6;
        if (controls.length <= 6) score += 4;

        if (score > bestScore) { best = node; bestScore = score; }
        node = node.parentElement;
      }
      return best || control.parentElement || control;
    }

    // ============= QUESTION DETECTION =============
    function isValidQuestion(t, answerLabelSet) {
      if (!t) return false;
      const s = norm(t);
      const sa = normAlpha(s);
      const tc = tokenCount(s);
      if (s.length < 15 || tc < 3) return false;
      const hasQ = /(what|when|where|why|how|who|which|are|do|does|did|can|should|have|has)/i.test(s) || s.endsWith("?");
      if (!hasQ) return false;
      if (STOP_ANSWERS.has(sa) || (answerLabelSet && answerLabelSet.has(sa))) return false;
      if (/please select|select from|need help|what does this mean/i.test(s)) return false;
      return true;
    }

    function questionFitness(s, answerLabelSet) {
      const sa = normAlpha(s);
      let score = 0;
      if (s.endsWith("?")) score += 5;
      if (tokenCount(s) >= 5) score += 3;
      if (/how|what|where|when|who|which/i.test(s)) score += 3;
      if (/why|should|would|could|have|has/i.test(s)) score += 2;
      if (!STOP_ANSWERS.has(sa)) score += 2;
      if (!(answerLabelSet && answerLabelSet.has(sa))) score += 2;
      if (s.length > 40) score += 2;
      return score;
    }

    function findGroupQuestion(container, mainControl, answerLabelSet) {
      const cands = [];
      const push = (text, base) => { const t = norm(text); if (t) cands.push({ text: t, base }); };

      const primary = container.querySelector(".mint-question__text, .question-text, .field-question, .form-question, .input-label, .question-title, .form-label, .control-label");
      if (primary) push(textOf(primary), 12);

      const legend = container.closest("fieldset")?.querySelector(":scope > legend");
      if (legend) push(textOf(legend), 10);

      const labelIds = (mainControl.getAttribute("aria-labelledby") || container.getAttribute("aria-labelledby") || "")
        .split(/\s+/).filter(Boolean);
      for (const id of labelIds) {
        const el = document.getElementById(id);
        if (el) push(textOf(el), 9);
      }

      const heads = Array.from(container.querySelectorAll(":scope h1,h2,h3,h4,h5,[role='heading']")).filter(isVisible);
      for (const h of heads) push(textOf(h), 8);

      // Text-analysis fallback
      const containerText = norm(textOf(container));
      if (containerText) {
        const segments = containerText.split(/\.\s+|\n+/);
        for (const seg of segments) {
          const s = seg.trim();
          if (isValidQuestion(s, answerLabelSet)) push(s, 6 + Math.min(3, (s.match(/(what|when|where|why|how|who|which)/gi) || []).length));
        }
      }

      const scored = cands
        .map((c) => ({ ...c, score: c.base + questionFitness(c.text, answerLabelSet) }))
        .filter((c) => isValidQuestion(c.text, answerLabelSet))
        .sort((a, b) => b.score - a.score);

      return scored.length ? scored[0].text : "";
    }

    // ============= HELP TEXT =============
    function extractHelp(container, mainControl) {
      const ids = (mainControl.getAttribute("aria-describedby") || container.getAttribute("aria-describedby") || "")
        .split(/\s+/).filter(Boolean);
      for (const id of ids) {
        const el = document.getElementById(id);
        const text = norm(textOf(el));
        if (text) return { text, source: "aria" };
      }
      const helpEl = container.querySelector(".help,.hint,.tooltip,[data-help],[data-tooltip],[aria-live='polite'],.mint-help,.mint-tooltip");
      if (helpEl) {
        const text = norm(textOf(helpEl));
        if (text) return { text, source: "tooltip" };
      }
      return null;
    }

    // ============= LABELS FOR CHOICE INPUTS =============
    function labelForControl(el, container) {
      let labelTxt = "";
      const id = el.getAttribute("id");

      if (id) {
        const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lab) labelTxt = norm(textOf(lab));
      }
      if (!labelTxt) {
        const wrapper = el.closest("label");
        if (wrapper) {
          const clone = wrapper.cloneNode(true);
          clone.querySelectorAll("input,select,textarea,button").forEach((n) => n.remove());
          labelTxt = norm(clone.textContent || "");
        }
      }
      if (!labelTxt) {
        const siblings = Array.from(el.parentElement?.children || []);
        const sibTxt = siblings.filter((s) => s !== el).map((s) => norm(textOf(s))).find(Boolean);
        if (sibTxt) labelTxt = sibTxt;
      }
      if (!labelTxt) {
        const textEl = el.closest(".radio,.checkbox,.mint-radio,.mint-checkbox")?.querySelector(
          ".radio__text,.checkbox__text,.mint-radio__text,.mint-checkbox__text,.label-text"
        );
        if (textEl) labelTxt = norm(textOf(textEl));
      }
      return labelTxt;
    }

    // ============= DATE SIGNALS (unambiguous) =============
    function whichDatePart(el) {
      const check = (s) => {
        const bag = (s || "").toLowerCase();
        const hit = [];
        if (/\bday\b|(^|[^a-z])dd([^a-z]|$)/i.test(bag)) hit.push("day");
        if (/\bmonth\b|(^|[^a-z])mm([^a-z]|$)/i.test(bag)) hit.push("month");
        if (/\byear\b|(^|[^a-z])yyyy?([^a-z]|$)/i.test(bag)) hit.push("year");
        return hit;
      };
      const idnameHits = check((el.getAttribute("id") || "") + " " + (el.getAttribute("name") || ""));
      if (idnameHits.length === 1) return idnameHits[0];

      const ariaHits = check((el.getAttribute("aria-label") || "") + " " + (el.getAttribute("placeholder") || ""));
      if (ariaHits.length === 1) return ariaHits[0];

      return null; // ambiguous or none
    }

    // ============= SCAN =============
    const allControls = Array.from(document.querySelectorAll("input,select,textarea")).filter(isVisible);

    // Build a stable set of unique question containers
    const containerSet = new Set();
    const containers = [];
    for (const el of allControls) {
      const q = findQuestionContainer(el);
      const key = q ? cssPath(q) : "";
      if (key && !containerSet.has(key)) { containerSet.add(key); containers.push(q); }
    }

    const usedControls = new Set(); // mark elements already represented (e.g., in variants)
    const fields = [];
    const pushField = (f) => fields.push(f);
    const rank = (t) => ({ variants:5, radio:4, checkbox:4, select:3, date:2, number:2, textarea:1, text:0 }[t] || 0);

    for (const qContainer of containers) {
      const controls = Array.from(qContainer.querySelectorAll("input,select,textarea")).filter(isVisible);
      if (!controls.length) continue;

      // ---- Radio/checkbox groups by name
      const byName = new Map();
      for (const el of controls) {
        if (usedControls.has(el)) continue;
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (tag === "input" && (type === "radio" || type === "checkbox")) {
          const name = el.getAttribute("name") || "__noname__" + cssPath(el);
          if (!byName.has(name)) byName.set(name, []);
          byName.get(name).push(el);
        }
      }

      // ---- Selects
      const selects = controls.filter((c) => c.tagName.toLowerCase() === "select" && !usedControls.has(c));

      // ---- Emit VARIANTS first (prevents duplicates later)
      (function emitVariantsIfAny() {
        if (!byName.size || !selects.length) return;

        // choose the dominant radio group (by size)
        let bestName = null, bestCount = -1, bestGroup = [];
        for (const [name, arr] of byName.entries()) {
          const type0 = (arr[0].getAttribute("type") || "").toLowerCase();
          if (type0 !== "radio") continue; // only radios combine with select
          if (arr.length > bestCount) { bestCount = arr.length; bestName = name; bestGroup = arr; }
        }
        if (!bestGroup.length) return;

        // Pair with the "nearest" select (first visible)
        const select = selects[0];
        if (!select) return;

        // Build answers and question
        const answerLabelSet = new Set();
        const radioAnswers = bestGroup.map((el) => {
          const id = el.id || "";
          const labelTxt = labelForControl(el, qContainer);
          if (labelTxt) answerLabelSet.add(normAlpha(labelTxt));
          return {
            value: el.value || "on",
            label: labelTxt,
            checked: !!el.checked,
            locator: id ? `#${CSS.escape(id)}` : shortLocator(el, qContainer),
            visible: isVisible(el)
          };
        });

        const selectAnswers = Array.from(select.options || []).map((o) => ({
          value: o.value,
          label: norm(o.textContent || ""),
          checked: !!o.selected,
          locator: shortLocator(select, qContainer),
          visible: isVisible(select)
        }));

        const main = bestGroup[0];
        const question = findGroupQuestion(qContainer, main, answerLabelSet) || findGroupQuestion(qContainer, select, answerLabelSet) || "";
        const help = extractHelp(qContainer, main) || extractHelp(qContainer, select) || null;
        const containerKey = buildContainerKey(qContainer, question);
        const required = bestGroup.some((r) => r.required) || select.required || false;

        pushField({
          containerKey,
          containerCssPath: cssPath(qContainer),
          name: bestName,
          id: main.getAttribute("id") || null,
          question,
          controlType: "variants",
          variants: [
            { type: "radio", answers: radioAnswers, visible: true, radioName: bestName },
            { type: "select", answers: selectAnswers, visible: true, selectLocator: shortLocator(select, qContainer) }
          ],
          default: null,
          constraints: { required },
          formatting: {},
          help
        });

        // mark used
        bestGroup.forEach((el) => usedControls.add(el));
        usedControls.add(select);
      })();

      // ---- Emit remaining radio/checkbox groups
      for (const [name, group] of byName) {
        if (group.every((g) => usedControls.has(g))) continue;
        const type = (group[0].getAttribute("type") || "").toLowerCase();
        const answerLabelSet = new Set();
        const items = group.map((el) => {
          const id = el.id || "";
          const labelTxt = labelForControl(el, qContainer);
          if (labelTxt) answerLabelSet.add(normAlpha(labelTxt));
          return {
            value: el.value || "on",
            label: labelTxt,
            checked: !!el.checked,
            locator: id ? `#${CSS.escape(id)}` : shortLocator(el, qContainer),
            visible: isVisible(el)
          };
        });

        const main = group[0];
        const question = findGroupQuestion(qContainer, main, answerLabelSet) || "";
        const help = extractHelp(qContainer, main) || null;
        const containerKey = buildContainerKey(qContainer, question);
        const required = group.some((g) => g.hasAttribute("required") || g.getAttribute("aria-required") === "true");

        pushField({
          containerKey,
          containerCssPath: cssPath(qContainer),
          name,
          id: main.getAttribute("id") || items[0]?.locator || null,
          question,
          controlType: type,
          answers: items,
          default: null,
          constraints: { required },
          formatting: {},
          help
        });
        group.forEach((el) => usedControls.add(el));
      }

      // ---- Standalone selects (not used by variants)
      for (const sel of selects) {
        if (usedControls.has(sel)) continue;
        const opts = Array.from(sel.options || []).map((o) => ({
          value: o.value,
          label: norm(o.textContent || ""),
          checked: !!o.selected,
          locator: shortLocator(sel, qContainer),
          visible: isVisible(sel)
        }));
        const answerLabelSet = new Set(opts.map((o) => normAlpha(o.label)));
        const question = findGroupQuestion(qContainer, sel, answerLabelSet) || "";
        const help = extractHelp(qContainer, sel) || null;
        const containerKey = buildContainerKey(qContainer, question);
        let def = null;
        const selOpt = opts.find((o) => o.checked);
        if (selOpt) def = selOpt.value;

        pushField({
          containerKey,
          containerCssPath: cssPath(qContainer),
          name: sel.getAttribute("name") || null,
          id: sel.getAttribute("id") || null,
          question,
          controlType: "select",
          answers: opts,
          default: def,
          constraints: { required: sel.hasAttribute("required") || sel.getAttribute("aria-required") === "true" },
          formatting: {},
          help
        });
        usedControls.add(sel);
      }

      // ---- Single inputs & DATE groups
      const singles = controls.filter((c) => {
        if (usedControls.has(c)) return false;
        const t = (c.getAttribute("type") || "").toLowerCase();
        return c.tagName.toLowerCase() === "textarea" || t === "" || t === "text" || t === "number" || t === "date";
      });

      // group date parts by stem
      const stemOf = (el) => {
        const bag = (el.getAttribute("name") || el.getAttribute("id") || "").toLowerCase();
        return bag.replace(/(day|dd|month|mm|year|yyyy|yy)/g, "@");
      };

      const dateGroups = new Map();
      for (const el of singles) {
        const part = whichDatePart(el);
        if (!part) continue;
        const key = stemOf(el);
        const parts = dateGroups.get(key) || { day: null, month: null, year: null, els: [] };
        if (part === "day" && !parts.day) parts.day = el;
        if (part === "month" && !parts.month) parts.month = el;
        if (part === "year" && !parts.year) parts.year = el;
        parts.els.push(el);
        dateGroups.set(key, parts);
      }

      for (const [, parts] of dateGroups) {
        const present = [parts.day, parts.month, parts.year].filter(Boolean).length;
        if (present < 2) continue;
        const main = parts.month || parts.year || parts.day;
        const question = findGroupQuestion(qContainer, main, new Set()) || "";
        const help = extractHelp(qContainer, main) || null;
        const containerKey = buildContainerKey(qContainer, question);
        const { min, max } = minMaxOf(main);

        pushField({
          containerKey,
          containerCssPath: cssPath(qContainer),
          name: main.getAttribute("name") || null,
          id: main.getAttribute("id") || null,
          question,
          controlType: "date",
          subLocators: {
            day: parts.day ? shortLocator(parts.day, qContainer) : null,
            month: parts.month ? shortLocator(parts.month, qContainer) : null,
            year: parts.year ? shortLocator(parts.year, qContainer) : null
          },
          default: null,
          constraints: {
            required: main.hasAttribute("required") || main.getAttribute("aria-required") === "true",
            min, max
          },
          formatting: {},
          help
        });
        if (parts.day) usedControls.add(parts.day);
        if (parts.month) usedControls.add(parts.month);
        if (parts.year) usedControls.add(parts.year);
      }

      // remaining singles (text/number/textarea)
      for (const el of singles) {
        if (usedControls.has(el)) continue;
        const t = (el.getAttribute("type") || "").toLowerCase();
        const controlType =
          el.tagName.toLowerCase() === "textarea" ? "textarea" :
          t === "number" ? "number" :
          t === "date" ? "date" : "text";

        const question = findGroupQuestion(qContainer, el, new Set()) || "";
        const help = extractHelp(qContainer, el) || null;
        const containerKey = buildContainerKey(qContainer, question);
        const { min, max } = minMaxOf(el);

        pushField({
          containerKey,
          containerCssPath: cssPath(qContainer),
          name: el.getAttribute("name") || null,
          id: el.getAttribute("id") || null,
          question,
          controlType,
          default: el.value || null,
          constraints: {
            required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
            min, max
          },
          formatting: {},
          help
        });
        usedControls.add(el);
      }
    }

    // ============= DE-DUPLICATION =============
    // 1) If a container produced a 'variants', keep only the variants for that container.
    const byContainer = new Map();
    for (const f of fields) {
      const key = f.containerCssPath;
      if (!byContainer.has(key)) byContainer.set(key, []);
      byContainer.get(key).push(f);
    }
    const step1 = [];
    for (const list of byContainer.values()) {
      const hasVariants = list.some((x) => x.controlType === "variants");
      if (hasVariants) {
        // keep only the best variants (if multiple, keep the one with a non-empty question)
        const variants = list.filter((x) => x.controlType === "variants")
          .sort((a, b) => (b.question?.length || 0) - (a.question?.length || 0));
        step1.push(variants[0]);
      } else {
        step1.push(...list);
      }
    }

    // 2) For radio/checkbox: keep only one per name (prefer the one with a longer question)
    const finalMap = new Map();
    for (const f of step1) {
      const isChoice = f.controlType === "radio" || f.controlType === "checkbox";
      const key = isChoice ? `choice|${f.name || ""}` : `other|${f.containerKey}|${f.name || f.id || ""}`;
      const prev = finalMap.get(key);
      const better =
        !prev ? f :
        rank(f.controlType) !== rank(prev.controlType) ? (rank(f.controlType) > rank(prev.controlType) ? f : prev) :
        (norm(f.question).length > norm(prev.question).length ? f : prev);
      finalMap.set(key, better);
    }

    // 3) Also collapse exact duplicate signatures
    const out = Array.from(finalMap.values());
    const dedupSig = new Set();
    const result = [];
    for (const f of out) {
      const sig = JSON.stringify([f.controlType, f.name || f.id || "", norm(f.question), f.containerCssPath]);
      if (dedupSig.has(sig)) continue;
      dedupSig.add(sig);
      result.push(f);
    }

    return result;
  });

  if (args.out) {
    await writeFile(resolve(args.out), JSON.stringify(fields, null, 2) + "\n", "utf8");
    console.log(`Wrote ${fields.length} fields to ${basename(resolve(args.out))}`);
  } else {
    console.log(JSON.stringify(fields, null, 2));
  }

  await browser.close();
}

// --------------- CLI ---------------
function parseArgs(argv) {
  const out = { timeout: 45000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") out.url = argv[++i];
    else if (a === "--file") out.file = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--wait") out.wait = argv[++i];
    else if (a === "--timeout") out.timeout = +argv[++i];
  }
  return out;
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});

