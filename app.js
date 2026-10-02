let currentAudio = null;
let currentPlayingElement = null;
let soundsByKey = {};
let soundElements = [];
let copiedRow = null;
let copiedTimeoutId = null;
let copiedFlashTimeoutId = null;
const DOUBLE_CLICK_MS = 500;
const COPIED_VISIBLE_MS = 1100;
const COPIED_FLASH_MS = 400;
const MOCK_GAIN_SCALE = 0.2;

// Offline testing fallback: five mock sounds with distinct 8-bit waveforms.
// Each note is [frequencyHz, seconds]; noise ignores the frequency.
const MOCK_CATALOG = {
    version: "offline (mock)",
    sounds: {
        "mock.test.sine": [{ mock: { wave: "sine", notes: [[523.25, 0.1], [659.25, 0.1], [783.99, 0.2]] } }],
        "mock.test.square": [{ mock: { wave: "square", notes: [[220, 0.09], [220, 0.09], [277.18, 0.09], [329.63, 0.18]] } }],
        "mock.test.sawtooth": [{ mock: { wave: "sawtooth", notes: [[110, 0.12], [138.59, 0.12], [164.81, 0.12], [220, 0.24]] } }],
        "mock.test.triangle": [{ mock: { wave: "triangle", notes: [[880, 0.08], [1174.66, 0.08], [880, 0.08], [587.33, 0.2]] } }],
        "mock.test.noise": [{ mock: { wave: "noise", notes: [[0, 0.08], [0, 0.08], [0, 0.2]] } }],
    },
};
let audioCtx = null;
let currentMock = null;

const hideCopied = () => {
    if (copiedTimeoutId !== null) {
        clearTimeout(copiedTimeoutId);
        copiedTimeoutId = null;
    }
    if (copiedFlashTimeoutId !== null) {
        clearTimeout(copiedFlashTimeoutId);
        copiedFlashTimeoutId = null;
    }
    if (copiedRow) {
        copiedRow.classList.remove("show-copied");
        copiedRow.classList.remove("show-copied-flash");
        copiedRow = null;
    }
};

const showCopied = (row) => {
    hideCopied();
    copiedRow = row;
    row.classList.add("show-copied");
    row.classList.add("show-copied-flash");
    copiedTimeoutId = setTimeout(hideCopied, COPIED_VISIBLE_MS);
    copiedFlashTimeoutId = setTimeout(() => {
        copiedFlashTimeoutId = null;
        if (copiedRow) {
            copiedRow.classList.remove("show-copied-flash");
        }
    }, COPIED_FLASH_MS);
};

const copyText = (text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
};

const fallbackCopy = (text) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand("copy");
    } catch (_) {}
    textarea.remove();
};

const handleSoundClick = (soundKey, row) => {
    const now = performance.now();
    const lastClick = row._lastClick ?? -Infinity;

    if (row.classList.contains("show-copied")) {
        hideCopied();
        playSound(soundKey, row);
        row._lastClick = now;
        return;
    }

    if (now - lastClick <= DOUBLE_CLICK_MS) {
        row._lastClick = -Infinity;
        copyText(soundKey);
        showCopied(row);
        return;
    }

    if (copiedRow && copiedRow !== row) {
        hideCopied();
    }
    playSound(soundKey, row);
    row._lastClick = now;
};

const stopMock = () => {
    if (!currentMock) {
        return;
    }
    for (const timer of currentMock.timers) {
        clearTimeout(timer);
    }
    for (const source of currentMock.sources) {
        try {
            source.node.stop();
        } catch (_) {}
        try {
            source.node.disconnect();
        } catch (_) {}
    }
    try {
        currentMock.gain.disconnect();
    } catch (_) {}
    currentMock = null;
};

const stopPlayback = () => {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    stopMock();
    if (currentPlayingElement) {
        currentPlayingElement.classList.remove("playing");
        currentPlayingElement = null;
    }
};

const startMockNote = (wave, freq, dur, mock) => {
    if (wave === "noise") {
        const len = Math.max(1, Math.floor(audioCtx.sampleRate * dur));
        const buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / len);
        }
        const node = audioCtx.createBufferSource();
        node.buffer = buffer;
        node.connect(mock.gain);
        node.start();
        mock.sources.push({ node, base: 0 });
        return;
    }
    const node = audioCtx.createOscillator();
    node.type = wave;
    node.frequency.value = freq;
    node.connect(mock.gain);
    node.start();
    node.stop(audioCtx.currentTime + dur);
    mock.sources.push({ node, base: freq / parseFloat(document.getElementById("pitch").value) });
};

const playMockSound = (spec, element) => {
    stopPlayback();
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
    }
    const gain = audioCtx.createGain();
    gain.gain.value = parseFloat(document.getElementById("volume").value) * MOCK_GAIN_SCALE;
    gain.connect(audioCtx.destination);
    const mock = { sources: [], timers: [], gain };
    currentMock = mock;
    currentPlayingElement = element;
    element.classList.add("playing");
    let delay = 0;
    for (const [freq, dur] of spec.notes) {
        mock.timers.push(setTimeout(() => {
            if (currentMock !== mock) {
                return;
            }
            startMockNote(spec.wave, freq * parseFloat(document.getElementById("pitch").value), dur, mock);
        }, delay * 1000));
        delay += dur;
    }
    mock.timers.push(setTimeout(() => {
        if (currentMock === mock) {
            stopPlayback();
        }
    }, delay * 1000 + 50));
};

const playSound = (soundKey, element) => {
    stopPlayback();
    const variants = soundsByKey[soundKey];
    const randomVariant = variants[Math.floor(Math.random() * variants.length)];
    if (randomVariant.mock) {
        playMockSound(randomVariant.mock, element);
        return;
    }
    const hash = randomVariant.hash;
    const audioUrl = "https://resources.download.minecraft.net/" + hash.slice(0, 2) + "/" + hash;

    const audio = new Audio(audioUrl);
    audio.preservesPitch = false;
    audio.playbackRate = parseFloat(document.getElementById("pitch").value);
    audio.volume = parseFloat(document.getElementById("volume").value);
    audio.play().catch(() => {});

    currentAudio = audio;
    currentPlayingElement = element;
    element.classList.add("playing");
    audio.addEventListener("ended", stopPlayback);
};

const filterSounds = (query) => {
    const normalizedQuery = query.toLowerCase();

    for (const element of soundElements) {
        element.hidden = normalizedQuery !== "" && !element.dataset.key.includes(normalizedQuery);
    }
};

const loadCatalog = async () => {
    try {
        const response = await fetch("sounds.json");
        if (!response.ok) {
            throw new Error("sounds.json unreachable: " + response.status);
        }
        return await response.json();
    } catch (err) {
        console.warn("Falling back to mock sounds for testing:", err);
        return MOCK_CATALOG;
    }
};

const init = async () => {
    const catalog = await loadCatalog();
    soundsByKey = catalog.sounds;
    document.getElementById("version").textContent = "Minecraft " + catalog.version;

    const container = document.getElementById("app");
    const sortedKeys = Object.keys(soundsByKey).sort();
    const fragment = document.createDocumentFragment();

    for (const soundKey of sortedKeys) {
        const row = document.createElement("div");
        row.className = "sound";
        row.dataset.key = soundKey;
        const label = document.createElement("span");
        label.textContent = soundKey;
        const hint = document.createElement("span");
        hint.className = "copied-hint";
        hint.textContent = "copied to clipboard";
        hint.style.left = "calc(" + soundKey.length + "ch + 8ch)";
        row.appendChild(label);
        row.appendChild(hint);
        row.onclick = () => handleSoundClick(soundKey, row);
        fragment.appendChild(row);
        soundElements.push(row);
    }

    container.appendChild(fragment);
    document.getElementById("search").addEventListener("input", (event) => filterSounds(event.target.value));
    document.getElementById("pitch").addEventListener("input", (event) => {
        const pitch = parseFloat(event.target.value);
        document.getElementById("pitch-label").textContent = "(" + pitch.toFixed(1) + "x)";
        if (currentAudio) currentAudio.playbackRate = pitch;
        if (currentMock) {
            for (const source of currentMock.sources) {
                if (source.node.frequency) {
                    source.node.frequency.value = source.base * pitch;
                }
            }
        }
    });

    document.getElementById("volume").addEventListener("input", (event) => {
        const volume = parseFloat(event.target.value);
        document.getElementById("volume-label").textContent = "(" + Math.round(volume * 100) + "%)";
        if (currentAudio) currentAudio.volume = volume;
        if (currentMock) currentMock.gain.gain.value = volume * MOCK_GAIN_SCALE;
    });
};

init();
