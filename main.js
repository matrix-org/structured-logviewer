/*
Copyright 2020 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import {tag as t} from "./html.js";
import {openFile, saveFile, readFileAsText} from "./file.js";

const main = document.querySelector("main");

let selectedItemNode;
let rootItem;
let itemByRef;
let itemsRefFrom;

const logLevels = [undefined, "All", "Debug", "Detail", "Info", "Warn", "Error", "Fatal", "Off"];

main.addEventListener("click", event => {
    if (event.target.classList.contains("toggleExpanded")) {
        const li = event.target.parentElement.parentElement;
        li.classList.toggle("expanded");
    } else {
        // allow clicking any links other than .item in the timeline, like refs
        if (event.target.tagName === "A" && !event.target.classList.contains("item")) {
            return;
        }
        const itemNode = event.target.closest(".item");
        if (itemNode) {
            // we don't want scroll to jump when clicking
            // so prevent default behaviour, and select and push to history manually
            event.preventDefault();
            selectNode(itemNode);
            history.pushState(null, null, `#${itemNode.id}`);
        }
    }
});

window.addEventListener("hashchange", () => {
    const id = window.location.hash.substr(1);
    const itemNode = document.getElementById(id);
    if (itemNode && itemNode.closest("main")) {
        ensureParentsExpanded(itemNode);
        selectNode(itemNode);
        itemNode.scrollIntoView({behavior: "smooth", block: "nearest"});
    }
});

function selectNode(itemNode) {
    if (selectedItemNode) {
        selectedItemNode.classList.remove("selected");
    }
    selectedItemNode = itemNode;
    selectedItemNode.classList.add("selected");
    let item = rootItem;
    let parent;
    const indices = selectedItemNode.id.split("/").map(i => parseInt(i, 10));
    for(const i of indices) {
        parent = item;
        item = itemChildren(item)[i];
    }
    showItemDetails(item, parent, selectedItemNode);
}

function ensureParentsExpanded(itemNode) {
    let li = itemNode.parentElement.parentElement;
    while (li.tagName === "LI") {
        li.classList.add("expanded");
        li = li.parentElement.parentElement;
    }
}

function stringifyItemValue(value) {
    if (typeof value === "object" && value !== null) {
        return JSON.stringify(value, undefined, 2);
    } else {
        return value + "";
    }
}

function showItemDetails(item, parent, itemNode) {
    const parentOffset = itemStart(parent) ? `${itemStart(item) - itemStart(parent)}ms` : "none";
    const expandButton = t.button("Expand recursively");
    expandButton.addEventListener("click", () => expandResursively(itemNode.parentElement.parentElement));
    const collapseButton = t.button("Collapse children");
    collapseButton.addEventListener("click", () => collapseChildren(itemNode.parentElement.parentElement));
    const start = itemStart(item);
    let errorNodes;
    const error = itemError(item);
    if (error) {
        errorNodes = [
            `${error.name} ${error.message}`,
            t.br(),
            error.stack
        ];
    } else {
        errorNodes = ["none"];
    }
    const aside = t.aside([
        t.h3(itemCaption(item)),
        t.p([t.strong("Log level: "), logLevels[itemLevel(item)]]),
        t.p([t.strong("Error: "), ...errorNodes]),
        t.p([t.strong("Parent offset: "), parentOffset]),
        t.p([t.strong("Start: "), new Date(start).toString(), ` (${start})`]),
        t.p([t.strong("Duration: "), `${itemDuration(item)}ms`]),
        t.p([t.strong("Child count: "), itemChildren(item) ? `${itemChildren(item).length}` : "none"]),
        t.p([t.strong("Forced finish: "), (itemForcedFinish(item) || false) + ""]),
        t.p(t.strong("Values:")),
        t.ul({class: "values"}, Object.entries(itemValues(item)).map(([key, value]) => {
            let valueNode;
            if (key === "ref") {
                const refItem = itemByRef.get(value);
                if (refItem) {
                    valueNode = t.a({href: `#${refItem.id}`}, itemCaption(refItem));
                } else {
                    valueNode = `unknown ref ${value}`;
                }
            } else if (key === "refId") {
                const refSources = itemsRefFrom.get(value) ?? [];
                valueNode = t.div([t.p([`${value}`, t.br(),`Found these references:`]),t.ul(refSources.map(item => {
                    return t.li(t.a({href: `#${item.id}`}, itemCaption(item)));
                }))]);
            } else {
                valueNode = stringifyItemValue(value);
            }
            return t.li([
                t.span({className: "key"}, normalizeValueKey(key)),
                t.span({className: "value"}, valueNode)
            ]);
        })),
        t.p([expandButton, " ", collapseButton])
    ]);
    document.querySelector("aside").replaceWith(aside);
}

function expandResursively(li) {
    li.classList.add("expanded");
    const ol = li.querySelector("ol");
    if (ol) {
        const len = ol.children.length;
        for (let i = 0; i < len; i += 1) {
            expandResursively(ol.children[i]);
        }
    }
}

function collapseChildren(li) {
    const ol = li.querySelector("ol");
    if (ol) {
        const len = ol.children.length;
        for (let i = 0; i < len; i += 1) {
            ol.children[i].classList.remove("expanded");
        }
    }
}

document.getElementById("openFile").addEventListener("click", loadFile);
document.getElementById("saveFile").addEventListener("click", saveCurrentFile);

function getRootItemHeader(prevItem, item) {
    if (prevItem) {
        const diff = itemStart(item) - itemEnd(prevItem);
        if (diff >= 0) {
            return `+ ${formatDuration(diff)}`;
        } else {
            const overlap = -diff;
            if (overlap >= itemDuration(item)) {
                return `ran entirely in parallel with`;
            } else {
                return `ran ${formatDuration(-diff)} in parallel with`;
            }
        }
    } else {
        return new Date(itemStart(item)).toString();
    }
}

async function loadFile() {
    const file = await openFile();
    document.getElementById("filename").innerText = file.name;
    await loadBlob(file);
}

function saveCurrentFile() {
    if (lastOpenedBlob) {
        saveFile(lastOpenedBlob, lastOpenedBlob.name ?? "logfile.json");
    }
}

let lastOpenedBlob;

export async function loadBlob(blob) {
    lastOpenedBlob = blob;
    const json = await readFileAsText(blob);
    const logs = JSON.parse(json);
    logs.items.sort((a, b) => itemStart(a) - itemStart(b));
    rootItem = {c: logs.items};
    itemByRef = new Map();
    itemsRefFrom = new Map();
    preprocessRecursively(rootItem, null, itemByRef, itemsRefFrom, []);

    const fragment = logs.items.reduce((fragment, item, i, items) => {
        const prevItem = i === 0 ? null : items[i - 1];
        fragment.appendChild(t.section([
            t.h2(getRootItemHeader(prevItem, item)),
            t.div({className: "timeline"}, t.ol(itemToNode(item, [i])))
        ]));
        return fragment;
    }, document.createDocumentFragment());
    main.replaceChildren(fragment);
    main.scrollTop = main.scrollHeight;
}

// TODO: make this use processRecursively
function preprocessRecursively(item, parentElement, refsMap, refsFromMap, path) {
    item.s = (parentElement?.s || 0) + item.s;
    if (itemRefSource(item)) {
        refsMap.set(itemRefSource(item), item);
    }
    if (itemRef(item)) {
        let refs = refsFromMap.get(itemRef(item));
        if (!refs) {
            refs = [];
            refsFromMap.set(itemRef(item), refs);
        }
        refs.push(item);
    }
    if (itemChildren(item)) {
        for (let i = 0; i < itemChildren(item).length; i += 1) {
            // do it in advance for a child as we don't want to do it for the rootItem
            const child = itemChildren(item)[i];
            const childPath = path.concat(i);
            child.id = childPath.join("/");
            preprocessRecursively(child, item, refsMap, refsFromMap, childPath);
        }
    }
}

const MS_IN_SEC = 1000;
const MS_IN_MIN = MS_IN_SEC * 60;
const MS_IN_HOUR = MS_IN_MIN * 60;
const MS_IN_DAY = MS_IN_HOUR * 24;
function formatDuration(ms) {
    let str = "";
    if (ms > MS_IN_DAY) {
        const days = Math.floor(ms / MS_IN_DAY);
        ms -= days * MS_IN_DAY;
        str += `${days}d`;
    }
    if (ms > MS_IN_HOUR) {
        const hours = Math.floor(ms / MS_IN_HOUR);
        ms -= hours * MS_IN_HOUR;
        str += `${hours}h`;
    }
    if (ms > MS_IN_MIN) {
        const mins = Math.floor(ms / MS_IN_MIN);
        ms -= mins * MS_IN_MIN;
        str += `${mins}m`;
    }
    if (ms > MS_IN_SEC) {
        const secs = ms / MS_IN_SEC;
        str += `${secs.toFixed(2)}s`;
    } else if (ms > 0 || !str.length) {
        str += `${ms}ms`;
    }
    return str;
}

function pad(str, len, chr) {
    return chr.repeat(Math.max(0, len - str.length)) + str;
}

function formatTime(date) {
    return date.getHours().toString() + ":" + pad(date.getMinutes().toString(), 2, "0") + ":" + pad(date.getSeconds().toString(), 2, "0");
}

function itemChildren(item) { return item.c; }
function itemStart(item) { return item.s; }
function itemEnd(item) { return item.s + item.d; }
function itemDuration(item) { return item.d; }
function itemValues(item) { return item.v; }
function itemLevel(item) { return item.l; }
function itemLabel(item) { return item.v?.l; }
function itemType(item) { return item.v?.t; }
function itemError(item) { return item.e; }
function itemForcedFinish(item) { return item.f; }
function itemRef(item) { return item.v?.ref; }
function itemRefSource(item) { return item.v?.refId; }
function itemShortErrorMessage(item) {
    if (itemError(item)) {
        const e = itemError(item);
        return e.name || e.stack.substr(0, e.stack.indexOf("\n")); 
    }
}

function itemCaption(item) {
    if (itemLabel(item) && itemError(item)) {
        return `${itemLabel(item)} (${itemShortErrorMessage(item)})`;
    } if (itemType(item) === "network") {
        return `${itemValues(item)?.method} ${itemValues(item)?.url}`;
    } else if (itemLabel(item) && itemValues(item)?.id) {
        return `${itemLabel(item)} ${itemValues(item).id}`;
    } else if (itemLabel(item) && itemValues(item)?.status) {
        return `${itemLabel(item)} (${itemValues(item).status})`;
    } else if (itemLabel(item) && itemValues(item)?.type) {
        return `${itemLabel(item)} (${itemValues(item)?.type})`;
    } else if (itemRef(item)) {
        const refItem = itemByRef.get(itemRef(item));
        if (refItem) {
            return `ref "${itemCaption(refItem)}"`
        } else {
            return `unknown ref ${itemRef(item)}`
        }
    } else {
        return itemLabel(item) || itemType(item);
    }
}
function normalizeValueKey(key) {
    switch (key) {
        case "t": return "type";
        case "l": return "label";
        default: return key;
    }
} 

// returns the node and the total range (recursively) occupied by the node
function itemToNode(item, parentType) {
    const startDate = new Date(itemStart(item));
    const type = itemType(item) ?? parentType;
    const hasChildren = !!itemChildren(item)?.length;
    const className = {
        item: true,
        "has-children": hasChildren,
        error: itemError(item),
        [`type-${type}`]: !!type,
        [`level-${itemLevel(item)}`]: true,
    };

    const id = item.id;
    let captionNode;
    if (itemRef(item)) {
        const refItem = itemByRef.get(itemRef(item));
        if (refItem) {
            captionNode = ["ref ", t.a({href: `#${refItem.id}`}, itemCaption(refItem))];
        }
    }
    if (!captionNode) {
        let refs = '';
        const refId = itemRefSource(item);
        if (refId) {
            const refSources = itemsRefFrom.get(refId);
            if (refSources?.length > 0) {
                refs = refs + ` (${refSources.length} ${refSources.length === 1 ? "ref" : "refs"})`;
            }
        }
        captionNode = itemCaption(item) + refs;
    }
    const li = t.li([
        t.div([
            hasChildren ? t.button({className: "toggleExpanded"}) : "",
            t.a({className, id, href: `#${id}`}, [
                t.span({class: "caption"}, captionNode),
                t.span({class: "duration"}, ` ${formatTime(startDate)} (${formatDuration(itemDuration(item))})`),
            ])
        ])
    ]);
    if (itemChildren(item) && itemChildren(item).length) {
        li.appendChild(t.ol(itemChildren(item).map(item => {
            return itemToNode(item, type);
        })));
    }
    return li;
}

const highlightForm = document.getElementById("highlightForm");

highlightForm.addEventListener("submit", evt => {
    evt.preventDefault();
    const matchesOutput = document.getElementById("highlightMatches");
    const query = document.getElementById("highlight").value;
    if (query) {
        matchesOutput.innerText = "Searching…";
        let matches = 0;
        processRecursively(rootItem, item => {
            let domNode = document.getElementById(item.id);
            if (itemMatchesFilter(item, query)) {
                matches += 1;
                domNode.classList.add("highlighted");
                domNode = domNode.parentElement;
                while (domNode.nodeName !== "SECTION") {
                    if (domNode.nodeName === "LI") {
                        domNode.classList.add("expanded");
                    }
                    domNode = domNode.parentElement;
                }
            } else {
                domNode.classList.remove("highlighted");
            }
        });
        matchesOutput.innerText = `${matches} matches`;
    } else {
        for (const node of document.querySelectorAll(".highlighted")) {
            node.classList.remove("highlighted");
        }
        matchesOutput.innerText = "";
    }
});

function itemMatchesFilter(item, query) {
    if (itemError(item)) {
        if (valueMatchesQuery(itemError(item), query), undefined) {
            return true;
        }
    }
    return valueMatchesQuery(itemValues(item), query, undefined);
}

function valueMatchesQuery(value, query, key) {
    if (typeof value === "string" && value.includes(query)) {
        return true;
    } else if (typeof value === "number" && value.toString().includes(query)) {
        return true;
    } else if (key && key.includes(query)) {
        return true;
    } else if (typeof value === "object" && value !== null) {
        for (const key in value) {
            if (value.hasOwnProperty(key) && valueMatchesQuery(value[key], query, key)) {
                return true;
            }
        }
    }
    return false;
}

function processRecursively(item, callback, parentItem) {
    if (item.id) {
        callback(item, parentItem);
    }
    if (itemChildren(item)) {
        for (let i = 0; i < itemChildren(item).length; i += 1) {
            // do it in advance for a child as we don't want to do it for the rootItem
            const child = itemChildren(item)[i];
            processRecursively(child, callback, item);
        }
    }
}

document.getElementById("collapseAll").addEventListener("click", () => {
    for (const node of document.querySelectorAll(".expanded")) {
        node.classList.remove("expanded");
    }
});
document.getElementById("hideCollapsed").addEventListener("click", () => {
    for (const node of document.querySelectorAll("section > div.timeline > ol > li:not(.expanded)")) {
        node.closest("section").classList.add("hidden");
    }
});
document.getElementById("hideHighlightedSiblings").addEventListener("click", () => {
    for (const node of document.querySelectorAll(".highlighted")) {
        const list = node.closest("ol");
        const siblings = Array.from(list.querySelectorAll("li > div > a:not(.highlighted)")).map(n => n.closest("li"));
        for (const sibling of siblings) {
            if (!sibling.classList.contains("expanded")) {
                sibling.classList.add("hidden");
            }
        }
    }
});
document.getElementById("showAll").addEventListener("click", () => {
    for (const node of document.querySelectorAll(".hidden")) {
        node.classList.remove("hidden");
    }
});
