"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const ROOT = __dirname;

const server = http.createServer((req, res) => {
    let requestPath = decodeURIComponent(
        req.url.split("?")[0]
    );

    if (requestPath === "/") {
        requestPath = "/index.html";
    }

    const safePath = path.normalize(
        path.join(ROOT, requestPath)
    );

    if (!safePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.stat(safePath, (error, stats) => {
        if (error || !stats.isFile()) {
            res.writeHead(404);
            res.end("Not found");
            return;
        }

        const ext = path.extname(safePath).toLowerCase();

        const types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon"
        };

        res.writeHead(200, {
            "Content-Type":
                types[ext] ||
                "application/octet-stream"
        });

        fs.createReadStream(safePath).pipe(res);
    });
});


const wss = new WebSocket.Server({
    server
});


const panels = new Set();

const devices = new Map();

const pairCodes = new Map();


function send(ws, data) {

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(
            JSON.stringify(data)
        );
    }
}


function broadcastToPanels(data) {

    for (const panel of panels) {
        send(panel, data);
    }
}


function createId(prefix) {

    return (
        prefix +
        "_" +
        crypto.randomBytes(8).toString("hex")
    );
}


function createToken() {

    return crypto
        .randomBytes(32)
        .toString("hex");
}


function cleanName(name) {

    if (typeof name !== "string") {
        return "Dispositivo";
    }

    return name
        .trim()
        .slice(0, 40) ||
        "Dispositivo";
}


function devicePublicData(device) {

    return {
        id: device.id,
        name: device.name,
        deviceType: device.deviceType,
        status: device.ws ? "online" : "offline",
        screenSharing:
            !!device.screenSharing,
        lastSeen:
            device.lastSeen
    };
}


function findDevice(id) {

    return devices.get(id);
}


/*
    Cuando un teléfono se conecta,
    primero queda registrado como socket.
*/

wss.on("connection", (ws) => {

    ws.role = null;
    ws.deviceId = null;
    ws.panelId = null;

    send(ws, {
        type: "connected"
    });


    ws.on("message", raw => {

        let message;

        try {

            message =
                JSON.parse(
                    raw.toString()
                );

        } catch {

            send(ws, {
                type: "error",
                error: "JSON inválido"
            });

            return;
        }


        handleMessage(
            ws,
            message
        );

    });


    ws.on("close", () => {

        /*
            PANEL
        */

        if (ws.role === "panel") {

            panels.delete(ws);

            for (
                const [code, info]
                of pairCodes
            ) {

                if (
                    info.panel === ws
                ) {
                    pairCodes.delete(code);
                }

            }

            return;
        }


        /*
            DISPOSITIVO
        */

        if (
            ws.role === "device" &&
            ws.deviceId
        ) {

            const device =
                devices.get(
                    ws.deviceId
                );


            if (
                device &&
                device.ws === ws
            ) {

                device.ws = null;

                device.lastSeen =
                    new Date().toISOString();


                broadcastToPanels({

                    type:
                        "device_disconnected",

                    deviceId:
                        device.id

                });

            }

        }

    });

});


function handleMessage(
    ws,
    message
) {

    const type =
        message.type;


    /*
        ============================
        PANEL
        ============================
    */

    if (
        type === "panel_register"
    ) {

        ws.role = "panel";

        ws.panelId =
            createId("panel");

        panels.add(ws);


        send(ws, {

            type: "panel_ready",

            panelId:
                ws.panelId

        });


        /*
            Mandar dispositivos existentes
        */

        for (
            const device
            of devices.values()
        ) {

            send(ws, {

                type:
                    "device_connected",

                device:
                    devicePublicData(device)

            });

        }

        return;
    }


    /*
        ============================
        CREAR CÓDIGO
        ============================
    */

    if (
        type === "create_pair_code"
    ) {

        if (
            ws.role !== "panel"
        ) {
            return;
        }


        const code =
            String(
                message.code || ""
            );


        if (
            !/^\d{6}$/.test(code)
        ) {

            send(ws, {

                type: "error",

                error:
                    "Código inválido"

            });

            return;
        }


        pairCodes.set(code, {

            panel: ws,

            created:
                Date.now(),

            expires:
                Date.now() +
                5 * 60 * 1000

        });


        send(ws, {

            type:
                "pair_code_created",

            code

        });

        return;
    }


    /*
        ============================
        VINCULAR TELÉFONO
        ============================
    */

    if (
        type === "pair_device"
    ) {

        const code =
            String(
                message.code || ""
            );


        const pair =
            pairCodes.get(code);


        if (
            !pair ||
            pair.expires <
            Date.now()
        ) {

            pairCodes.delete(code);

            send(ws, {

                type: "pair_result",

                ok: false,

                error:
                    "Código incorrecto o expirado."

            });

            return;
        }


        const deviceId =
            createId("device");


        const token =
            createToken();


        const device = {

            id:
                deviceId,

            name:
                cleanName(
                    message.name
                ),

            deviceType:
                cleanName(
                    message.deviceType ||
                    "phone"
                ),

            token,

            ws,

            screenSharing:
                false,

            lastSeen:
                new Date().toISOString()

        };


        devices.set(
            deviceId,
            device
        );


        ws.role = "device";

        ws.deviceId =
            deviceId;


        pairCodes.delete(code);


        send(ws, {

            type:
                "pair_result",

            ok: true,

            device: {
                ...devicePublicData(
                    device
                )
            },

            token

        });


        broadcastToPanels({

            type:
                "device_connected",

            device:
                devicePublicData(
                    device
                )

        });


        return;
    }


    /*
        ============================
        RECONEXIÓN
        ============================
    */

    if (
        type === "device_reconnect"
    ) {

        const device =
            findDevice(
                message.deviceId
            );


        if (
            !device ||
            device.token !==
            message.token
        ) {

            send(ws, {

                type:
                    "reconnect_result",

                ok: false,

                error:
                    "Credenciales inválidas."

            });

            return;
        }


        if (
            device.ws &&
            device.ws !== ws
        ) {

            try {
                device.ws.close();
            } catch {}

        }


        device.ws = ws;

        device.lastSeen =
            new Date().toISOString();


        ws.role = "device";

        ws.deviceId =
            device.id;


        send(ws, {

            type:
                "reconnect_result",

            ok: true,

            device:
                devicePublicData(
                    device
                )

        });


        broadcastToPanels({

            type:
                "device_connected",

            device:
                devicePublicData(
                    device
                )

        });


        return;
    }


    /*
        ============================
        EVENTO DEL TELÉFONO
        ============================
    */

    if (
        type === "device_event"
    ) {

        if (
            ws.role !== "device"
        ) {
            return;
        }


        const device =
            devices.get(
                ws.deviceId
            );


        if (!device) {
            return;
        }


        device.lastSeen =
            new Date().toISOString();


        broadcastToPanels({

            type:
                "device_event",

            deviceId:
                device.id,

            title:
                String(
                    message.title ||
                    "Evento"
                ).slice(0, 100),

            description:
                String(
                    message.description ||
                    ""
                ).slice(0, 300)

        });


        return;
    }


    /*
        ============================
        COMANDO DEL PANEL
        ============================
    */

    if (
        type === "device_command"
    ) {

        if (
            ws.role !== "panel"
        ) {
            return;
        }


        const device =
            devices.get(
                message.deviceId
            );


        if (
            !device ||
            !device.ws
        ) {

            send(ws, {

                type: "error",

                error:
                    "El dispositivo no está conectado."

            });

            return;
        }


        send(
            device.ws,
            {

                type:
                    "device_command",

                command:
                    message.command,

                seconds:
                    Number(
                        message.seconds || 0
                    )

            }
        );


        return;
    }


    /*
        Compatibilidad con el app.js
    */

    if (
        type === "request_screen" ||
        type === "stop_screen" ||
        type === "screen_timer"
    ) {

        if (
            ws.role !== "panel"
        ) {
            return;
        }


        const device =
            devices.get(
                message.deviceId
            );


        if (
            !device ||
            !device.ws
        ) {

            send(ws, {

                type: "error",

                error:
                    "Dispositivo desconectado."

            });

            return;
        }


        let command =
            type;


        send(
            device.ws,
            {

                type:
                    "device_command",

                command,

                seconds:
                    Number(
                        message.seconds || 0
                    )

            }
        );


        return;
    }


    /*
        ============================
        WEBRTC OFFER
        ============================
    */

    if (
        type === "webrtc_offer"
    ) {

        if (
            ws.role !== "device"
        ) {
            return;
        }


        const device =
            devices.get(
                ws.deviceId
            );


        if (!device) {
            return;
        }


        device.screenSharing =
            true;


        broadcastToPanels({

            type:
                "webrtc_offer",

            deviceId:
                device.id,

            offer:
                message.offer

        });


        broadcastToPanels({

            type:
                "screen_started",

            deviceId:
                device.id

        });


        return;
    }


    /*
        ============================
        WEBRTC ANSWER
        ============================
    */

    if (
        type === "webrtc_answer"
    ) {

        if (
            ws.role !== "panel"
        ) {
            return;
        }


        const device =
            devices.get(
                message.deviceId
            );


        if (
            !device ||
            !device.ws
        ) {
            return;
        }


        send(
            device.ws,
            {

                type:
                    "webrtc_answer",

                deviceId:
                    device.id,

                answer:
                    message.answer

            }
        );


        return;
    }


    /*
        ============================
        ICE CANDIDATE
        ============================
    */

    if (
        type === "webrtc_candidate"
    ) {

        const device =
            devices.get(
                message.deviceId
            );


        if (!device) {
            return;
        }


        if (
            ws.role === "device"
        ) {

            broadcastToPanels({

                type:
                    "webrtc_candidate",

                deviceId:
                    device.id,

                candidate:
                    message.candidate

            });

        }


        else if (
            ws.role === "panel"
        ) {

            if (device.ws) {

                send(
                    device.ws,
                    {

                        type:
                            "webrtc_candidate",

                        deviceId:
                            device.id,

                        candidate:
                            message.candidate

                    }
                );

            }

        }


        return;
    }


    /*
        ============================
        PANTALLA DETENIDA
        ============================
    */

    if (
        type === "screen_stopped"
    ) {

        if (
            ws.role !== "device"
        ) {
            return;
        }


        const device =
            devices.get(
                ws.deviceId
            );


        if (!device) {
            return;
        }


        device.screenSharing =
            false;


        broadcastToPanels({

            type:
                "screen_stopped",

            deviceId:
                device.id

        });


        return;
    }


    /*
        ============================
        LISTA DE DISPOSITIVOS
        ============================
    */

    if (
        type === "request_devices"
    ) {

        if (
            ws.role !== "panel"
        ) {
            return;
        }


        for (
            const device
            of devices.values()
        ) {

            send(ws, {

                type:
                    "device_connected",

                device:
                    devicePublicData(
                        device
                    )

            });

        }

        return;
    }

});


/*
    Limpieza de códigos expirados.
*/

setInterval(() => {

    const now =
        Date.now();

    for (
        const [code, info]
        of pairCodes
    ) {

        if (
            info.expires <= now
        ) {

            pairCodes.delete(code);

        }

    }

}, 30000);


/*
    Heartbeat.
*/

setInterval(() => {

    for (
        const ws
        of wss.clients
    ) {

        if (
            ws.readyState !==
            WebSocket.OPEN
        ) {
            continue;
        }


        try {

            ws.ping();

        } catch {}

    }

}, 15000);


server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Device Panel activo en el puerto ${PORT}`
        );

    }
);