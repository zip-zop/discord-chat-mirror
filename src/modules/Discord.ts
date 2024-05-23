/* eslint-disable @typescript-eslint/naming-convention */
import { WebhookClient, GatewayReceivePayload, GatewayDispatchEvents, GatewayOpcodes } from "discord.js";
import { channels, discordToken, serverId } from "../util/env.js";
import { Channel, Things } from "../typings/index.js";
import fetch, { HeadersInit } from "node-fetch";
import Websocket, { WebSocket, MessageEvent } from "ws";
import { RawAttachmentData, RawStickerData } from "discord.js/typings/rawDataTypes.js";

export const executeWebhook = (things: Things, webhookUrl: string): void => {
    const wsClient = new WebhookClient({ url: webhookUrl }); // Now dynamically using the passed URL
    wsClient.send(things).catch((e: any) => console.error(e));
};




export const createChannel = async (
    name: string,
    newId: string,
    pos: number,
    parentId?: string
): Promise<Channel> => {
    const effectiveHeaders: HeadersInit = {
        "Content-Type": "application/json"
    };

    if (discordToken) { // Only add Authorization header if discordToken is not undefined
        effectiveHeaders["Authorization"] = discordToken;
    }

    return fetch(`https://discord.com/api/v10/guilds/${newId}/channels`, {
        body: JSON.stringify({
            name,
            parentId, // It's okay to directly use snake_case here as it's a property name in the request body, not subject to naming conventions
            position: pos
        }),
        headers: effectiveHeaders,
        method: "POST"
    }).then(res => res.json()) as Promise<Channel>;
};


const parseEventData = (event: MessageEvent): string => {
    if (typeof event.data === "string") {
        return event.data;
    } else if (event.data instanceof ArrayBuffer) {
        // Handle ArrayBuffer if necessary
        return String.fromCharCode.apply(null, new Uint8Array(event.data));
    }
    // Handle other data types
    return JSON.stringify(event.data);
};


export const listenToWebSocket = (ws: WebSocket): void => {
    let heartbeatInterval: NodeJS.Timeout | null = null;
    let lastHeartbeatAck: number | null = null;
    let authenticated = false;

    ws.onopen = () => {
        console.log("Connected to the Discord API.");
    };
    
    ws.onmessage = (event: MessageEvent) => {
        const dataString = parseEventData(event);
        const payload: GatewayReceivePayload = JSON.parse(dataString);
        const { op, d, s, t } = payload;
        
        switch (op) {
            case GatewayOpcodes.Hello:
                try {
                    // Start sending heartbeats
                    heartbeatInterval = setInterval(() => {
                        ws.send(JSON.stringify({ op: GatewayOpcodes.Heartbeat, d: s }));

                        // Check for unresponsive connection
                        const currentTime = Date.now();
                        if (lastHeartbeatAck && currentTime - lastHeartbeatAck > 15000) {
                            console.log("Connection to Discord gateway is unresponsive.");
                        }
                    }, d.heartbeat_interval);
                    
                    // Authenticate with the Discord API
                    if (!authenticated) {
                        authenticated = true;
                        ws.send(JSON.stringify({
                            op: GatewayOpcodes.Identify,
                            d: {
                                token: discordToken,
                                properties: {
                                    $os: "linux",
                                    $browser: "test",
                                    $device: "test"
                                }
                            }
                        }));
                    }
                } catch (e) {
                    console.error("Error sending heartbeat or identifying:", e);
                    if (heartbeatInterval) clearInterval(heartbeatInterval);
                }
                break;
            case GatewayOpcodes.HeartbeatAck:
                // Update last heartbeat acknowledgement time
                lastHeartbeatAck = Date.now();
                break;
            case GatewayOpcodes.Dispatch:
                if (
                    (t === GatewayDispatchEvents.MessageCreate) &&
                    d.guild_id === serverId &&
                    d.channel_id in channels
                ) {
                    const {
                        content,
                        attachments,
                        embeds,
                        sticker_items,
                        author
                    } = d;
                    const webhookUrl: string = channels[d.channel_id];
                    let ext = "jpg";
                    let ub = " [USER]";
                    const { avatar, username, discriminator: discriminatorRaw, id } = author;
                    let discriminator: string | null = discriminatorRaw;
                    if (discriminator === "0") {
                        discriminator = null;
                    } else {
                        discriminator = `#${discriminator}`;
                    }

                    if (avatar?.startsWith("a_")) ext = "gif";
                    if (author.bot) ub = " [BOT]";

                    const things: Things = {
                        avatarURL: avatar
                            ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}`
                            : `https://cdn.discordapp.com/embed/avatars/${(BigInt(id) >> 22n) % 6n}.png`,
                        content: content ? content : "** **\n",
                        url: webhookUrl,
                        username: `${username}${discriminator ?? ""}${ub}`
                    };

                    if (embeds[0]) {
                        things.embeds = embeds;
                    } else if (sticker_items) {
                        things.files = sticker_items.map(
                            (a: RawStickerData) => `https://media.discordapp.net/stickers/${a.id}.webp`
                        );
                    } else if (attachments[0]) {
                        const fileSizeInBytes = Math.max(...attachments.map((a: RawAttachmentData) => a.size));
                        const fileSizeInMegabytes = fileSizeInBytes / (1024 * 1024);
                        if (fileSizeInMegabytes < 8) {
                            things.files = attachments.map((a: RawAttachmentData) => a.url);
                        } else {
                            things.content += attachments.map((a: RawAttachmentData) => a.url).join("\n");
                        }
                    }
                    console.log("Message: ", things);
                    executeWebhook(things, webhookUrl);
                }
                break;
            default:
                break;
        }
    };

    ws.onclose = () => {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        reconnect(); // Attempt to reconnect
    };
};

function reconnect(): void {
    // Attempt to reconnect after a delay (e.g., 5 seconds)
    setTimeout(() => {
        const ws: WebSocket = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");
        listenToWebSocket(ws); // Reattach event listeners
        console.log("~~~~RECONNECTED~~~~");
    }, 5000); // Adjust the delay as needed
}

export const initialWS: WebSocket = new Websocket("wss://gateway.discord.gg/?v=10&encoding=json");

// // export const listen = (): void => {
//     new Client({
//         intents: [
//             GatewayIntentBits.Guilds,
//             GatewayIntentBits.GuildMembers,
//             GatewayIntentBits.GuildMessages,
//             GatewayIntentBits.DirectMessages,
//             GatewayIntentBits.MessageContent
//         ],
//         closeTimeout: 6000
//     });

//     // eslint-disable-next-line @typescript-eslint/no-unsafe-call
//     const ws: Websocket = new Websocket("wss://gateway.discord.gg/?v=10&encoding=json");
//     let authenticated = false;
//     let heartbeatInterval: NodeJS.Timeout | null = null;
//     let lastHeartbeatAck: number | null = null;
//     ws.on("open", () => {
//         console.log("Connected to the Discord API.");
//     });
//     ws.onclose = () => {
//         // Clear heartbeat interval on WebSocket close
//         if (heartbeatInterval) clearInterval(heartbeatInterval);
//         console.log("WebSocket connection closed. Attempting to reconnect...");
//         // Implement logic here to attempt reconnection
//     };
//     ws.on("message", (data: [any]) => {
//         const payload: GatewayReceivePayload = JSON.parse(data.toString());
//         const { op, d, s, t } = payload;
//         switch (op) {
//             case GatewayOpcodes.Hello:
//                 try {
//                     // Start sending heartbeats
//                     heartbeatInterval = setInterval(() => {
//                         ws.send(JSON.stringify({ op: GatewayOpcodes.Heartbeat, d: s }));

//                         // Check for unresponsive connection
//                         const currentTime = Date.now();
//                         if (lastHeartbeatAck && currentTime - lastHeartbeatAck > 15000) {
//                             console.log("Connection to Discord gateway is unresponsive.");
//                         }
//                     }, d.heartbeat_interval);
                    
//                     // Authenticate with the Discord API
//                     if (!authenticated) {
//                         authenticated = true;
//                         ws.send(JSON.stringify({
//                             op: GatewayOpcodes.Identify,
//                             d: {
//                                 token: discordToken,
//                                 properties: {
//                                     $os: "linux",
//                                     $browser: "test",
//                                     $device: "test"
//                                 }
//                             }
//                         }));
//                     }
//                 } catch (e) {
//                     console.error("Error sending heartbeat or identifying:", e);
//                     if (heartbeatInterval) clearInterval(heartbeatInterval);
//                 }
//                 break;
//             case GatewayOpcodes.HeartbeatAck:
//                 // Update last heartbeat acknowledgement time
//                 lastHeartbeatAck = Date.now();
//                 break;
//             case GatewayOpcodes.Dispatch:
//                 if (
//                     (t === GatewayDispatchEvents.MessageCreate) &&
//                     d.guild_id === serverId &&
//                     d.channel_id in channels
//                 ) {
//                     console.log("d: ", d);
//                     console.log("--------");
//                     // Check if locked message.
//                     const {
//                         content,
//                         attachments,
//                         embeds,
//                         sticker_items,
//                         author
//                     } = d;
//                     console.log("author: ", author);
//                     console.log("content: ", content);
//                     console.log("condition1: ", author.id === "1023602697238237195");
//                     console.log("condition2: ", content.includes("Press the button to unlock the content..."));
//                     if (author.id === "1023602697238237195" && content.includes("Press the button to unlock the content...")) {
//                         console.log("Locked message");
//                         const unlockMessagePayload = {
//                             type: 3, // Indicates a button interaction
//                             guild_id: serverId,
//                             channel_id: d.channel_id,
//                             message_id: d.id,
//                             data: {
//                                 component_type: 2,
//                                 custom_id: "trade:7942" // Replace with the custom ID of the button
//                             }
//                         };
//                         const options = {
//                             method: "POST",
//                             headers: {
//                                 Authorization: discordToken ?? "",
//                                 "Content-Type": "application/json"
//                             },
//                             body: JSON.stringify(unlockMessagePayload)
//                         };

//                         fetch("https://discord.com/api/v10/interactions", options)
//                             .then(response => response.json())
//                             .then((res: any) => {
//                                 console.log("Button click simulated:", res);
//                             })
//                             .catch(error => {
//                                 console.error("Error simulating button click:", error);
//                             });
//                     }
//                     const webhookUrl: string = channels[d.channel_id];
//                     let ext = "jpg";
//                     let ub = " [USER]";
//                     const { avatar, username, discriminator: discriminatorRaw, id } = author;
//                     let discriminator: string | null = discriminatorRaw;
//                     if (discriminator === "0") {
//                         discriminator = null;
//                     } else {
//                         discriminator = `#${discriminator}`;
//                     }

//                     if (avatar?.startsWith("a_")) ext = "gif";
//                     if (author.bot) ub = " [BOT]";

//                     const things: Things = {
//                         avatarURL: avatar
//                             ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}`
//                             : `https://cdn.discordapp.com/embed/avatars/${(BigInt(id) >> 22n) % 6n}.png`,
//                         content: content ? content : "** **\n",
//                         url: webhookUrl,
//                         username: `${username}${discriminator ?? ""}${ub}`
//                     };

//                     if (embeds[0]) {
//                         things.embeds = embeds;
//                     } else if (sticker_items) {
//                         things.files = sticker_items.map(
//                             (a: RawStickerData) => `https://media.discordapp.net/stickers/${a.id}.webp`
//                         );
//                     } else if (attachments[0]) {
//                         const fileSizeInBytes = Math.max(...attachments.map((a: RawAttachmentData) => a.size));
//                         const fileSizeInMegabytes = fileSizeInBytes / (1024 * 1024);
//                         if (fileSizeInMegabytes < 8) {
//                             things.files = attachments.map((a: RawAttachmentData) => a.url);
//                         } else {
//                             things.content += attachments.map((a: RawAttachmentData) => a.url).join("\n");
//                         }
//                     }
//                     executeWebhook(things, webhookUrl);
//                 }
//                 break;
//             default:
//                 break;
//         }
//     });
// // };
