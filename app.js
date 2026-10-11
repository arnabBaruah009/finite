"use strict";
const STORAGE_KEY = "tasks";
const LOCAL_KEY = "finite.tasks";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const FRACTION_DIGITS = 7;
const SCALE = 10 ** FRACTION_DIGITS;
const openTasksButton = requiredElement("open-tasks", HTMLButtonElement);
const newTaskButton = requiredElement("new-task", HTMLButtonElement);
const stage = requiredElement("stage", HTMLElement);
const statusLine = requiredElement("status", HTMLParagraphElement);
const emptyNote = requiredElement("empty", HTMLParagraphElement);
const list = requiredElement("list", HTMLDivElement);
const backdrop = requiredElement("backdrop", HTMLDivElement);
const drawer = requiredElement("drawer", HTMLElement);
const drawerTitle = requiredElement("drawer-title", HTMLHeadingElement);
const closeDrawerButton = requiredElement("close-drawer", HTMLButtonElement);
const form = requiredElement("task-form", HTMLFormElement);
const titleInput = requiredElement("title", HTMLInputElement);
const targetInput = requiredElement("target", HTMLInputElement);
const formError = requiredElement("form-error", HTMLParagraphElement);
const saveButton = requiredElement("save-task", HTMLButtonElement);
const cancelButton = requiredElement("cancel-edit", HTMLButtonElement);
const taskList = requiredElement("task-list", HTMLUListElement);
const liveSummary = requiredElement("live-summary", HTMLParagraphElement);
const views = new Map();
let tasks = [];
let editingId = null;
let loaded = false;
let lastSummary = "";
let returnFocus = openTasksButton;
let writeQueue = Promise.resolve();
function requiredElement(id, constructor) {
    const element = document.getElementById(id);
    if (!(element instanceof constructor)) {
        throw new Error(`Missing #${id}`);
    }
    return element;
}
function hasChromeStorage() {
    return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}
function isTask(value) {
    if (!value || typeof value !== "object")
        return false;
    const task = value;
    return (typeof task.id === "string" &&
        task.id.length > 0 &&
        typeof task.title === "string" &&
        task.title.trim().length > 0 &&
        typeof task.targetDate === "string" &&
        !Number.isNaN(Date.parse(task.targetDate)));
}
function cleanTask(task) {
    return { id: task.id, title: task.title.trim(), targetDate: task.targetDate };
}
function serialize(items) {
    return JSON.stringify(items.map((task) => [task.id, task.title, task.targetDate]));
}
function createId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function formatRemaining(targetMs, nowMs) {
    const delta = targetMs - nowMs;
    const overdue = delta < 0;
    const units = Math.round((Math.abs(delta) / MS_PER_DAY) * SCALE);
    const whole = Math.floor(units / SCALE);
    const fracUnits = units % SCALE;
    return {
        whole: `${overdue ? "-" : ""}${whole}`,
        frac: `.${String(fracUnits).padStart(FRACTION_DIGITS, "0")}`,
        overdue,
    };
}
function formatCardDate(iso) {
    return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}
function formatTarget(iso) {
    return new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}
function toDatetimeLocalValue(iso) {
    const date = new Date(iso);
    const pad = (value) => String(value).padStart(2, "0");
    return [
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    ].join("T");
}
function readChromeStorage() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(STORAGE_KEY, (result) => {
            const message = chrome.runtime.lastError?.message;
            if (message) {
                reject(new Error(message));
                return;
            }
            const raw = result[STORAGE_KEY];
            const saved = Array.isArray(raw) ? raw.filter(isTask).map(cleanTask) : [];
            resolve(saved);
        });
    });
}
function writeChromeStorage(next) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set({ [STORAGE_KEY]: next }, () => {
            const message = chrome.runtime.lastError?.message;
            if (message)
                reject(new Error(message));
            else
                resolve();
        });
    });
}
function readLocalStorage() {
    try {
        const raw = localStorage.getItem(LOCAL_KEY);
        if (!raw)
            return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isTask).map(cleanTask) : [];
    }
    catch {
        return [];
    }
}
function writeLocalStorage(next) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
}
function loadTasks() {
    if (hasChromeStorage())
        return readChromeStorage();
    return Promise.resolve(readLocalStorage());
}
function saveTasks(next) {
    if (hasChromeStorage())
        return writeChromeStorage(next);
    try {
        writeLocalStorage(next);
        return Promise.resolve();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Could not save tasks.";
        return Promise.reject(new Error(message));
    }
}
function subscribe(onChange) {
    if (hasChromeStorage()) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === "local" && Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) {
                onChange();
            }
        });
        return;
    }
    window.addEventListener("storage", (event) => {
        if (event.key === LOCAL_KEY)
            onChange();
    });
}
function setInert(element, inert) {
    if ("inert" in element)
        element.inert = inert;
}
function showFormError(message) {
    formError.textContent = message;
    formError.hidden = false;
}
function clearFormError() {
    formError.textContent = "";
    formError.hidden = true;
}
function resetForm() {
    editingId = null;
    form.reset();
    saveButton.textContent = "Add task";
    drawerTitle.textContent = "New task";
    cancelButton.hidden = true;
    clearFormError();
    renderDrawer();
}
function startEdit(task) {
    editingId = task.id;
    titleInput.value = task.title;
    targetInput.value = toDatetimeLocalValue(task.targetDate);
    saveButton.textContent = "Save";
    drawerTitle.textContent = "Edit task";
    cancelButton.hidden = false;
    clearFormError();
    renderDrawer();
    openDrawer();
    titleInput.focus();
}
function svg(markup) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    element.setAttribute("viewBox", "0 0 16 16");
    element.setAttribute("width", "14");
    element.setAttribute("height", "14");
    element.setAttribute("aria-hidden", "true");
    element.innerHTML = markup;
    return element;
}
function createView() {
    const root = document.createElement("article");
    root.className = "card";
    const top = document.createElement("div");
    top.className = "card-top";
    const title = document.createElement("h2");
    title.className = "card-title";
    const more = document.createElement("button");
    more.type = "button";
    more.className = "more";
    more.setAttribute("aria-label", "Task actions");
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    more.append(svg(`<circle cx="3.2" cy="8" r="1.15" fill="currentColor"/><circle cx="8" cy="8" r="1.15" fill="currentColor"/><circle cx="12.8" cy="8" r="1.15" fill="currentColor"/>`));
    const menu = document.createElement("div");
    menu.className = "menu";
    menu.setAttribute("role", "menu");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.dataset.action = "edit";
    edit.textContent = "Edit";
    edit.setAttribute("role", "menuitem");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.dataset.action = "delete";
    remove.textContent = "Delete";
    remove.setAttribute("role", "menuitem");
    menu.append(edit, remove);
    top.append(title, more);
    const countdown = document.createElement("div");
    countdown.className = "countdown";
    countdown.setAttribute("aria-hidden", "true");
    const whole = document.createElement("span");
    whole.className = "large";
    const small = document.createElement("span");
    small.className = "small";
    const frac = document.createElement("span");
    frac.className = "frac";
    const unit = document.createElement("span");
    unit.className = "unit";
    unit.textContent = "days";
    small.append(frac, unit);
    countdown.append(whole, small);
    const foot = document.createElement("div");
    foot.className = "card-foot";
    const dateWrap = document.createElement("span");
    dateWrap.className = "date";
    dateWrap.append(svg(`<rect x="2.2" y="3.2" width="11.6" height="10.4" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2.2 6.4h11.6M5.2 1.8v2.6M10.8 1.8v2.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`));
    const date = document.createElement("span");
    dateWrap.append(date);
    foot.append(dateWrap);
    root.append(top, countdown, menu, foot);
    return {
        root,
        title,
        whole,
        frac,
        date,
        menu,
        more,
        targetMs: 0,
        lastWhole: "",
        lastFrac: "",
        overdue: false,
    };
}
function closeMenus() {
    let closed = false;
    for (const view of views.values()) {
        if (view.menu.classList.contains("is-open")) {
            view.menu.classList.remove("is-open");
            view.more.setAttribute("aria-expanded", "false");
            closed = true;
        }
    }
    return closed;
}
function toggleMenu(view) {
    const open = view.menu.classList.contains("is-open");
    closeMenus();
    if (!open) {
        view.menu.classList.add("is-open");
        view.more.setAttribute("aria-expanded", "true");
    }
}
function syncViews() {
    const nextIds = new Set(tasks.map((task) => task.id));
    for (const id of views.keys()) {
        if (!nextIds.has(id))
            views.delete(id);
    }
    const fragment = document.createDocumentFragment();
    for (const task of tasks) {
        let view = views.get(task.id);
        if (!view) {
            view = createView();
            views.set(task.id, view);
        }
        view.root.dataset.id = task.id;
        view.targetMs = task.targetMs;
        view.title.textContent = task.title;
        view.date.textContent = formatCardDate(task.targetDate);
        fragment.append(view.root);
    }
    list.replaceChildren(fragment);
    emptyNote.hidden = tasks.length > 0;
}
function renderDrawer() {
    taskList.replaceChildren();
    if (tasks.length === 0) {
        const empty = document.createElement("li");
        empty.className = "drawer-empty";
        empty.textContent = "Nothing yet.";
        taskList.append(empty);
        return;
    }
    for (const task of tasks) {
        const row = document.createElement("li");
        row.className = "task-row";
        if (task.id === editingId)
            row.classList.add("is-editing");
        const title = document.createElement("p");
        title.className = "row-title";
        title.textContent = task.title;
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "text-button";
        edit.dataset.action = "edit";
        edit.dataset.id = task.id;
        edit.textContent = "Edit";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "text-button danger";
        remove.dataset.action = "delete";
        remove.dataset.id = task.id;
        remove.textContent = "Delete";
        const meta = document.createElement("p");
        meta.className = "row-meta";
        meta.textContent = formatTarget(task.targetDate);
        row.append(title, edit, remove, meta);
        taskList.append(row);
    }
}
function summaries(now) {
    if (tasks.length === 0)
        return "No tasks.";
    return tasks
        .map((task) => {
        const days = Math.abs((task.targetMs - now) / MS_PER_DAY).toFixed(1);
        return task.targetMs < now
            ? `${task.title} is overdue by ${days} days`
            : `${task.title} has ${days} days left`;
    })
        .join(". ");
}
function paint(now) {
    for (const view of views.values()) {
        const remaining = formatRemaining(view.targetMs, now);
        if (view.lastWhole !== remaining.whole) {
            view.whole.textContent = remaining.whole;
            view.lastWhole = remaining.whole;
        }
        if (view.lastFrac !== remaining.frac) {
            view.frac.textContent = remaining.frac;
            view.lastFrac = remaining.frac;
        }
        if (view.overdue !== remaining.overdue) {
            view.root.classList.toggle("is-overdue", remaining.overdue);
            view.overdue = remaining.overdue;
        }
    }
    if (!loaded)
        return;
    const summary = summaries(now);
    if (summary !== lastSummary) {
        lastSummary = summary;
        liveSummary.textContent = summary;
    }
}
function applyTasks(next) {
    tasks = next.map((task) => ({
        id: task.id,
        title: task.title.trim(),
        targetDate: task.targetDate,
        targetMs: Date.parse(task.targetDate),
    }));
    syncViews();
    renderDrawer();
    loaded = true;
    statusLine.hidden = true;
    document.body.classList.add("is-ready");
    paint(Date.now());
}
function persist(mutate) {
    const job = writeQueue.then(async () => {
        const current = await loadTasks();
        const next = mutate(current);
        await saveTasks(next);
        applyTasks(next);
    });
    writeQueue = job.then(() => undefined, () => undefined);
    return job;
}
async function reloadFromStorage() {
    try {
        const next = await loadTasks();
        if (serialize(next) === serialize(tasks))
            return;
        applyTasks(next);
    }
    catch {
    }
}
function openDrawer() {
    document.body.classList.add("is-drawer-open");
    drawer.setAttribute("aria-hidden", "false");
    openTasksButton.setAttribute("aria-expanded", "true");
    setInert(drawer, false);
    setInert(stage, true);
}
function closeDrawer() {
    document.body.classList.remove("is-drawer-open");
    drawer.setAttribute("aria-hidden", "true");
    openTasksButton.setAttribute("aria-expanded", "false");
    setInert(drawer, true);
    setInert(stage, false);
    returnFocus.focus();
}
function taskById(id) {
    return tasks.find((task) => task.id === id);
}
function viewById(id) {
    return views.get(id);
}
function upsert(current, nextTask) {
    const index = current.findIndex((task) => task.id === nextTask.id);
    const next = current.filter((task) => task.id !== nextTask.id);
    next.splice(index < 0 ? next.length : index, 0, nextTask);
    return next;
}
function bindUi() {
    openTasksButton.addEventListener("click", () => {
        if (document.body.classList.contains("is-drawer-open")) {
            closeDrawer();
            return;
        }
        returnFocus = openTasksButton;
        openDrawer();
    });
    newTaskButton.addEventListener("click", () => {
        returnFocus = newTaskButton;
        resetForm();
        openDrawer();
        titleInput.focus();
    });
    closeDrawerButton.addEventListener("click", closeDrawer);
    backdrop.addEventListener("click", closeDrawer);
    cancelButton.addEventListener("click", () => {
        resetForm();
        titleInput.focus();
    });
    titleInput.addEventListener("input", clearFormError);
    targetInput.addEventListener("input", clearFormError);
    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape")
            return;
        if (closeMenus()) {
            event.preventDefault();
            return;
        }
        if (document.body.classList.contains("is-drawer-open")) {
            event.preventDefault();
            closeDrawer();
        }
    });
    document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element))
            return;
        if (target.closest(".menu") || target.closest(".more"))
            return;
        closeMenus();
    });
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const title = titleInput.value.replace(/\s+/g, " ").trim();
        const target = new Date(targetInput.value);
        if (!title) {
            showFormError("Add a title.");
            titleInput.focus();
            return;
        }
        if (!targetInput.value || Number.isNaN(target.getTime())) {
            showFormError("Add a date and time.");
            targetInput.focus();
            return;
        }
        const id = editingId ?? createId();
        const nextTask = {
            id,
            title,
            targetDate: target.toISOString(),
        };
        void persist((current) => upsert(current, nextTask)).then(() => {
            resetForm();
            closeDrawer();
        }, () => showFormError("Could not save this task."));
    });
    list.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element))
            return;
        const card = target.closest(".card");
        const id = card instanceof HTMLElement ? card.dataset.id : undefined;
        if (!id)
            return;
        if (target.closest(".more")) {
            const view = viewById(id);
            if (view)
                toggleMenu(view);
            return;
        }
        const button = target.closest("[data-action]");
        if (!(button instanceof HTMLButtonElement))
            return;
        const action = button.dataset.action;
        closeMenus();
        if (action === "edit") {
            const task = taskById(id);
            if (!task)
                return;
            returnFocus = viewById(id)?.more ?? newTaskButton;
            startEdit(task);
            return;
        }
        if (action === "delete") {
            void persist((current) => current.filter((task) => task.id !== id)).then(() => {
                if (editingId === id)
                    resetForm();
            }, () => showFormError("Could not delete this task."));
        }
    });
    taskList.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element))
            return;
        const button = target.closest("button");
        if (!(button instanceof HTMLButtonElement) || !taskList.contains(button))
            return;
        const id = button.dataset.id;
        const action = button.dataset.action;
        if (!id || !action)
            return;
        if (action === "edit") {
            const task = taskById(id);
            if (task)
                startEdit(task);
            return;
        }
        if (action === "delete") {
            void persist((current) => current.filter((task) => task.id !== id)).then(() => {
                if (editingId === id)
                    resetForm();
            }, () => showFormError("Could not delete this task."));
        }
    });
}
function startClock() {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const tick = () => {
        paint(Date.now());
        if (motion.matches)
            window.setTimeout(tick, 1000);
        else
            requestAnimationFrame(tick);
    };
    tick();
}
function main() {
    bindUi();
    subscribe(() => {
        void reloadFromStorage();
    });
    void loadTasks().then((saved) => applyTasks(saved), () => {
        applyTasks([]);
        statusLine.textContent = "Saved tasks could not be read.";
        statusLine.hidden = false;
    });
    startClock();
}
main();
