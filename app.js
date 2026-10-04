"use strict";

const state = {
    currentPage: "screens",
    socket: null,
    devices: [],
    activity: [],
    pairCode: null,
    selectedDevice: null,
    screenTimer: null,
    reconnectTimer: null,
    reconnecting: false,
    peers: new Map()
};

const $ = id => document.getElementById(id);

const sidebar = $("sidebar");
const overlay = $("overlay");
const menuButton = $("menuButton");
const closeMenu = $("closeMenu");
const pageTitle = $("pageTitle");
const pageSubtitle = $("pageSubtitle");
const connectionDot = $("connectionDot");
const connectionText = $("connectionText");
const deviceList = $("deviceList");
const screenModal = $("screenModal");
const remoteScreen = $("remoteScreen");
const screenPlaceholder = $("screenPlaceholder");


/* ================= TOAST ================= */

function toast(message) {
    const box = document.createElement("div");
    box.className = "toast";
    box.textContent = message;

    $("toastContainer").appendChild(box);

    setTimeout(() => box.remove(), 3000);
}


/* ================= HTML ================= */

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


/* ================= ACTIVIDAD ================= */

function loadActivity() {
    try {
        state.activity =
            JSON.parse(
                localStorage.getItem("cp_activity") || "[]"
            );
    } catch {
        state.activity = [];
    }
}

function saveActivity() {
    localStorage.setItem(
        "cp_activity",
        JSON.stringify(state.activity)
    );
}

function addActivity(title, description = "") {
    state.activity.unshift({
        title,
        description,
        time: new Date().toLocaleString()
    });

    state.activity =
        state.activity.slice(0, 100);

    saveActivity();
    renderActivity();
}

function renderActivity() {
    const container = $("activityList");

    if (!state.activity.length) {
        container.innerHTML = `
            <div class="empty">
                <div class="empty-icon">◷</div>
                <h3>Sin actividad</h3>
                <p>Aquí aparecerán las conexiones y eventos.</p>
            </div>
        `;
        return;
    }

    container.innerHTML =
        state.activity.map(event => `
            <div class="activity-item">
                <strong>
                    ${escapeHTML(event.title)}
                </strong>

                <span>
                    ${escapeHTML(event.description)}
                    ·
                    ${escapeHTML(event.time)}
                </span>
            </div>
        `).join("");
}


/* ================= MENU ================= */

function openMenu() {
    sidebar.classList.add("open");
    overlay.classList.add("show");
}

function closeSidebar() {
    sidebar.classList.remove("open");
    overlay.classList.remove("show");
}

menuButton.addEventListener(
    "click",
    openMenu
);

closeMenu.addEventListener(
    "click",
    closeSidebar
);

overlay.addEventListener(
    "click",
    closeSidebar
);


/* ================= PESTAÑAS ================= */

document
    .querySelectorAll(".menu-item")
    .forEach(button => {

        button.addEventListener(
            "click",
            () => {

                changePage(
                    button.dataset.page
                );

                closeSidebar();
            }
        );

    });


function changePage(page) {

    state.currentPage = page;

    document
        .querySelectorAll(".page")
        .forEach(section => {
            section.classList.remove("active");
        });


    const target =
        document.getElementById(
            "page-" + page
        );


    if (target) {
        target.classList.add("active");
    }


    document
        .querySelectorAll(".menu-item")
        .forEach(item => {

            item.classList.toggle(
                "active",
                item.dataset.page === page
            );

        });


    const titles = {

        screens: [
            "Pantallas",
            "Dispositivos conectados"
        ],

        connect: [
            "Conectar",
            "Vincular un dispositivo"
        ],

        activity: [
            "Actividad",
            "Eventos recientes"
        ],

        settings: [
            "Configuración",
            "Opciones del panel"
        ]

    };


    if (titles[page]) {

        pageTitle.textContent =
            titles[page][0];

        pageSubtitle.textContent =
            titles[page][1];
    }
}


/* ================= CONEXIÓN ================= */

function setConnection(online) {

    if (online) {

        connectionDot.classList.add(
            "online"
        );

        connectionText.textContent =
            "Conectado";

    } else {

        connectionDot.classList.remove(
            "online"
        );

        connectionText.textContent =
            "Servidor desconectado";
    }
}


function connectSocket() {

    if (
        state.socket &&
        (
            state.socket.readyState ===
            WebSocket.OPEN ||

            state.socket.readyState ===
            WebSocket.CONNECTING
        )
    ) {
        return;
    }


    const protocol =
        location.protocol === "https:"
            ? "wss:"
            : "ws:";


    const url =
        `${protocol}//${location.host}`;


    console.log(
        "Conectando WebSocket:",
        url
    );


    try {

        state.socket =
            new WebSocket(url);

    } catch (error) {

        console.error(error);

        setConnection(false);

        scheduleReconnect();

        return;
    }


    state.socket.addEventListener(
        "open",
        () => {

            console.log(
                "WebSocket conectado"
            );

            state.reconnecting = false;

            setConnection(true);

            sendSocket({
                type: "panel_register"
            });

            addActivity(
                "Servidor conectado",
                "Conexión WebSocket establecida."
            );

        }
    );


    state.socket.addEventListener(
        "close",
        () => {

            console.log(
                "WebSocket desconectado"
            );

            setConnection(false);

            scheduleReconnect();

        }
    );


    state.socket.addEventListener(
        "error",
        error => {

            console.error(
                "WebSocket error:",
                error
            );

            setConnection(false);

        }
    );


    state.socket.addEventListener(
        "message",
        event => {

            try {

                const message =
                    JSON.parse(
                        event.data
                    );

                handleServerMessage(
                    message
                );

            } catch (error) {

                console.error(
                    "Mensaje inválido:",
                    error
                );

            }

        }
    );
}


function scheduleReconnect() {

    if (state.reconnecting)
        return;

    state.reconnecting = true;

    clearTimeout(
        state.reconnectTimer
    );

    state.reconnectTimer =
        setTimeout(() => {

            state.reconnecting = false;

            connectSocket();

        }, 3000);
}


function sendSocket(data) {

    if (
        !state.socket ||
        state.socket.readyState !==
        WebSocket.OPEN
    ) {

        return false;
    }


    state.socket.send(
        JSON.stringify(data)
    );

    return true;
}


/* ================= GENERAR CÓDIGO ================= */

$("generateCode")
    .addEventListener(
        "click",
        generatePairCode
    );


function generatePairCode() {

    if (
        !state.socket ||
        state.socket.readyState !==
        WebSocket.OPEN
    ) {

        toast(
            "El servidor no está conectado."
        );

        return;
    }


    const code =
        String(
            Math.floor(
                100000 +
                Math.random() * 900000
            )
        );


    state.pairCode = code;

    $("codeValue").textContent =
        code;

    $("generatedCode")
        .classList.remove("hidden");


    sendSocket({

        type:
            "create_pair_code",

        code

    });


    addActivity(
        "Código generado",
        "Código de vinculación creado."
    );


    toast(
        "Código generado"
    );
}


/* ================= COPIAR ================= */

$("copyCode")
    .addEventListener(
        "click",
        async () => {

            if (!state.pairCode) {

                toast(
                    "Primero genera un código."
                );

                return;
            }


            try {

                await navigator
                    .clipboard
                    .writeText(
                        state.pairCode
                    );

                toast(
                    "Código copiado."
                );

            } catch {

                toast(
                    "No se pudo copiar."
                );

            }

        }
    );


/* ================= CONECTAR TELÉFONO ================= */

$("connectDevice")
    .addEventListener(
        "click",
        connectDevice
    );


function connectDevice() {

    const code =
        $("pairCodeInput")
            .value
            .trim();


    const name =
        $("deviceNameInput")
            .value
            .trim() ||
        "Teléfono";


    if (!/^\d{6}$/.test(code)) {

        showConnectMessage(
            "Escribe un código de 6 números."
        );

        return;
    }


    if (
        !state.socket ||
        state.socket.readyState !==
        WebSocket.OPEN
    ) {

        showConnectMessage(
            "El servidor no está conectado."
        );

        toast(
            "Servidor desconectado."
        );

        return;
    }


    sendSocket({

        type:
            "pair_device",

        code,

        name,

        deviceType:
            "phone"

    });


    showConnectMessage(
        "Solicitando conexión..."
    );
}


function showConnectMessage(message) {

    $("connectMessage")
        .textContent = message;
}


/* ================= DISPOSITIVOS ================= */

function renderDevices() {

    if (!state.devices.length) {

        deviceList.innerHTML = `
            <div class="empty">

                <div class="empty-icon">
                    ▣
                </div>

                <h3>
                    No hay dispositivos
                </h3>

                <p>
                    Conecta un teléfono para verlo aquí.
                </p>

                <button
                    id="goConnect"
                    class="white-btn">
                    Conectar dispositivo
                </button>

            </div>
        `;


        $("goConnect").onclick =
            () => changePage("connect");

        return;
    }


    deviceList.innerHTML =
        state.devices.map(device => {

            const online =
                device.status === "online";


            return `
                <div
                    class="device-card"
                    data-device-id="${escapeHTML(device.id)}">

                    <div class="device-head">

                        <div class="device-icon">
                            ▯
                        </div>

                        <div>

                            <div class="device-name">
                                ${escapeHTML(device.name)}
                            </div>

                            <div class="device-type">
                                ${escapeHTML(
                                    device.deviceType ||
                                    "phone"
                                )}
                            </div>

                        </div>

                    </div>


                    <div class="status">

                        <span
                            class="status-dot ${
                                online
                                    ? "online"
                                    : ""
                            }">
                        </span>

                        ${
                            online
                                ? "En línea"
                                : "Desconectado"
                        }

                    </div>


                    <div class="device-actions">

                        <button
                            class="white-btn"
                            data-action="screen"
                            data-id="${escapeHTML(device.id)}">
                            Pantalla
                        </button>

                        <button
                            class="dark-btn"
                            data-action="stop"
                            data-id="${escapeHTML(device.id)}">
                            Detener
                        </button>

                        <button
                            class="dark-btn"
                            data-action="timer"
                            data-id="${escapeHTML(device.id)}">
                            Temporizador
                        </button>

                        <button
                            class="dark-btn"
                            data-action="remove"
                            data-id="${escapeHTML(device.id)}">
                            Quitar
                        </button>

                    </div>

                </div>
            `;

        }).join("");


    deviceList
        .querySelectorAll(
            "[data-action]"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                handleDeviceAction
            );

        });
}


function updateDevice(device) {

    const index =
        state.devices.findIndex(
            item =>
                item.id === device.id
        );


    if (index === -1) {

        state.devices.push(
            device
        );

    } else {

        state.devices[index] = {
            ...state.devices[index],
            ...device
        };

    }


    renderDevices();
}


function updateDeviceStatus(
    id,
    status
) {

    const device =
        state.devices.find(
            item =>
                item.id === id
        );


    if (!device)
        return;


    device.status =
        status;


    renderDevices();
}


function updateDeviceScreen(
    id,
    sharing
) {

    const device =
        state.devices.find(
            item =>
                item.id === id
        );


    if (!device)
        return;


    device.screenSharing =
        sharing;


    renderDevices();
}


/* ================= ACCIONES ================= */

function handleDeviceAction(event) {

    const button =
        event.currentTarget;


    const id =
        button.dataset.id;


    const action =
        button.dataset.action;


    const device =
        state.devices.find(
            item =>
                item.id === id
        );


    if (!device)
        return;


    if (action === "screen") {

        openScreen(device);

        return;
    }


    if (action === "stop") {

        stopRemoteScreen(device);

        return;
    }


    if (action === "timer") {

        openScreen(device);

        $("timerBox")
            .classList.remove(
                "hidden"
            );

        return;
    }


    if (action === "remove") {

        state.devices =
            state.devices.filter(
                item =>
                    item.id !== id
            );

        renderDevices();

        toast(
            "Dispositivo quitado."
        );
    }
}


/* ================= MODAL ================= */

function openScreen(device) {

    state.selectedDevice =
        device;


    $("screenModalTitle")
        .textContent =
        device.name;


    screenModal
        .classList.remove(
            "hidden"
        );


    $("timerBox")
        .classList.add(
            "hidden"
        );


    if (device.screenSharing) {

        remoteScreen.style.display =
            "block";

        screenPlaceholder.style.display =
            "none";

    } else {

        remoteScreen.style.display =
            "none";

        screenPlaceholder.style.display =
            "grid";
    }


    if (
        sendSocket({

            type:
                "request_screen",

            deviceId:
                device.id

        })
    ) {

        toast(
            "Solicitud enviada."
        );

    } else {

        toast(
            "Servidor desconectado."
        );

    }
}


/* ================= DETENER ================= */

$("stopRemoteScreen")
    .addEventListener(
        "click",
        () => {

            if (
                state.selectedDevice
            ) {

                stopRemoteScreen(
                    state.selectedDevice
                );

            }

        }
    );


function stopRemoteScreen(device) {

    sendSocket({

        type:
            "stop_screen",

        deviceId:
            device.id

    });


    device.screenSharing =
        false;


    remoteScreen.srcObject =
        null;


    remoteScreen.style.display =
        "none";


    screenPlaceholder.style.display =
        "grid";


    addActivity(
        "Pantalla detenida",
        device.name
    );


    toast(
        "Solicitud de detención enviada."
    );
}


/* ================= TEMPORIZADOR ================= */

$("timerRemoteScreen")
    .addEventListener(
        "click",
        () => {

            $("timerBox")
                .classList.toggle(
                    "hidden"
                );

        }
    );


document
    .querySelectorAll(
        "#timerBox button"
    )
    .forEach(button => {

        button.addEventListener(
            "click",
            () => {

                if (
                    !state.selectedDevice
                )
                    return;


                const seconds =
                    Number(
                        button.dataset.time
                    );


                sendSocket({

                    type:
                        "screen_timer",

                    deviceId:
                        state.selectedDevice.id,

                    seconds

                });


                clearTimeout(
                    state.screenTimer
                );


                state.screenTimer =
                    setTimeout(
                        () => {

                            stopRemoteScreen(
                                state.selectedDevice
                            );

                        },
                        seconds * 1000
                    );


                $("timerBox")
                    .classList.add(
                        "hidden"
                    );


                toast(
                    `Temporizador de ${seconds} segundos.`
                );

            }
        );

    });


/* ================= CERRAR MODAL ================= */

$("closeScreenModal")
    .addEventListener(
        "click",
        closeScreenModal
    );


screenModal.addEventListener(
    "click",
    event => {

        if (
            event.target ===
            screenModal
        ) {

            closeScreenModal();

        }

    }
);


function closeScreenModal() {

    screenModal
        .classList.add(
            "hidden"
        );


    clearTimeout(
        state.screenTimer
    );

    state.screenTimer = null;
}


/* ================= ACTUALIZAR ================= */

$("refreshDevices")
    .addEventListener(
        "click",
        () => {

            if (
                sendSocket({
                    type:
                        "request_devices"
                })
            ) {

                toast(
                    "Lista actualizada."
                );

            } else {

                toast(
                    "Servidor desconectado."
                );

            }

        }
    );


/* ================= ACTIVIDAD ================= */

$("clearActivity")
    .addEventListener(
        "click",
        () => {

            state.activity = [];

            saveActivity();

            renderActivity();

            toast(
                "Actividad limpiada."
            );

        }
    );


/* ================= CONFIGURACIÓN ================= */

$("notificationsToggle")
    .addEventListener(
        "change",
        event => {

            localStorage.setItem(
                "cp_notifications",
                event.target.checked
            );

        }
    );


$("animationsToggle")
    .addEventListener(
        "change",
        event => {

            document.body.dataset.animations =
                event.target.checked
                    ? "on"
                    : "off";

        }
    );


/* ================= SERVIDOR ================= */

function handleServerMessage(message) {

    console.log(
        "Servidor:",
        message
    );


    switch (message.type) {

        case "connected":

            setConnection(true);

            break;


        case "panel_ready":

            setConnection(true);

            break;


        case "device_connected":

            if (message.device) {

                updateDevice(
                    message.device
                );

                addActivity(
                    "Dispositivo conectado",
                    message.device.name
                );

            }

            break;


        case "device_disconnected":

            updateDeviceStatus(
                message.deviceId,
                "offline"
            );

            addActivity(
                "Dispositivo desconectado",
                message.deviceId
            );

            break;


        case "pair_result":

            if (message.ok) {

                showConnectMessage(
                    "Dispositivo conectado correctamente."
                );

                toast(
                    "Dispositivo conectado."
                );

                if (message.device) {

                    updateDevice(
                        message.device
                    );

                }

            } else {

                showConnectMessage(
                    message.error ||
                    "No se pudo conectar."
                );

                toast(
                    message.error ||
                    "Error de conexión."
                );
            }

            break;


        case "device_event":

            addActivity(
                message.title ||
                "Evento",

                message.description ||
                ""
            );

            break;


        case "screen_started":

            updateDeviceScreen(
                message.deviceId,
                true
            );

            break;


        case "screen_stopped":

            updateDeviceScreen(
                message.deviceId,
                false
            );


            if (
                state.selectedDevice &&
                state.selectedDevice.id ===
                message.deviceId
            ) {

                remoteScreen.srcObject =
                    null;

                remoteScreen.style.display =
                    "none";

                screenPlaceholder.style.display =
                    "grid";
            }

            break;


        case "webrtc_offer":

            handleWebRTCOffer(
                message
            );

            break;


        case "webrtc_candidate":

            handleWebRTCCandidate(
                message
            );

            break;


        case "error":

            toast(
                message.error ||
                "Error del servidor."
            );

            break;

    }
}


/* ================= WEBRTC ================= */

async function handleWebRTCOffer(
    message
) {

    const deviceId =
        message.deviceId;


    let peer =
        state.peers.get(
            deviceId
        );


    if (!peer) {

        peer =
            new RTCPeerConnection({

                iceServers: [
                    {
                        urls:
                            "stun:stun.l.google.com:19302"
                    }
                ]

            });


        state.peers.set(
            deviceId,
            peer
        );


        peer.ontrack =
            event => {

                const stream =
                    event.streams[0];


                remoteScreen.srcObject =
                    stream;


                remoteScreen.style.display =
                    "block";


                screenPlaceholder.style.display =
                    "none";


                remoteScreen.play()
                    .catch(() => {});

            };


        peer.onicecandidate =
            event => {

                if (
                    event.candidate
                ) {

                    sendSocket({

                        type:
                            "webrtc_candidate",

                        deviceId,

                        candidate:
                            event.candidate

                    });

                }

            };


        peer.onconnectionstatechange =
            () => {

                if (
                    [
                        "failed",
                        "closed",
                        "disconnected"
                    ].includes(
                        peer.connectionState
                    )
                ) {

                    state.peers.delete(
                        deviceId
                    );

                }

            };

    }


    try {

        await peer.setRemoteDescription(
            new RTCSessionDescription(
                message.offer
            )
        );


        const answer =
            await peer.createAnswer();


        await peer.setLocalDescription(
            answer
        );


        sendSocket({

            type:
                "webrtc_answer",

            deviceId,

            answer

        });

    } catch (error) {

        console.error(
            "WebRTC offer error:",
            error
        );

    }
}


async function handleWebRTCCandidate(
    message
) {

    const peer =
        state.peers.get(
            message.deviceId
        );


    if (!peer)
        return;


    try {

        await peer.addIceCandidate(
            message.candidate
        );

    } catch (error) {

        console.error(
            "ICE error:",
            error
        );

    }
}


/* ================= INIT ================= */

loadActivity();

renderActivity();

renderDevices();

changePage("screens");

setConnection(false);

connectSocket();