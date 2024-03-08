const {
    DISCORD_TOKEN: discordToken,
    SERVER_ID: serverId,
    CH1,
    CH2
} = process.env;

// Function to parse CH environment variables and add them to a given object
function addToChannelsObject(envValue: string | undefined, channelsObject: object): void {
    if (!envValue) return;
    const [channelId, webhookUrl] = envValue.split(",");
    channelsObject[channelId] = webhookUrl;
}

// Initialize an empty object for channels
const channels = {};

// Adding channel configurations to the channels object
addToChannelsObject(CH1, channels);
addToChannelsObject(CH2, channels);

const headers = {
    "Content-Type": "application/json",
    Authorization: discordToken
};

// Exporting all variables including the consolidated channels object
export { discordToken, serverId, channels, headers };
