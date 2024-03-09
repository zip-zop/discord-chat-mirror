const {
    DISCORD_TOKEN: discordToken,
    SERVER_ID: serverId,
    CH1,
    CH2,
    CH3,
    CH4,
    CH5,
    CH6,
    CH7,
    CH8,
    CH9,
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
addToChannelsObject(CH3, channels);
addToChannelsObject(CH4, channels);
addToChannelsObject(CH5, channels);
addToChannelsObject(CH6, channels);
addToChannelsObject(CH7, channels);
addToChannelsObject(CH8, channels);
addToChannelsObject(CH9, channels);


const headers = {
    "Content-Type": "application/json",
    Authorization: discordToken
};

// Exporting all variables including the consolidated channels object
export { discordToken, serverId, channels, headers };
