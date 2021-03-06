const Discord = require("discord.js");
const Client = require("../haseul.js").Client;
const axios = require("axios");
const database = require("../db_queries/vlive_db.js");

const vlive = axios.create({
    baseURL: 'http://api.vfan.vlive.tv/vproxy/channelplus/',
    timeout: 5000
})
const app_id = '8c6cc7b45d2568fb668be6e05b6e5a3b';

exports.tasks = async function() {

    vliveLoop().catch(console.error);

}

async function vliveLoop() {

    let startTime = Date.now();

    console.log("Started checking VLIVE at " + new Date(startTime).toUTCString());

    let channelNotifs = await database.getAllVliveChannels();
    let channelSeqs = new Set(channelNotifs.map(x => x.channelSeq));

    await (async () => {
        for (let channelSeq of channelSeqs.values()) {
            
            let response;
            try {
                response = await vlive.get('getChannelVideoList', { params: { app_id, channelSeq, maxNumOfRows: 10, pageNo: 1 } });
            } catch(e) {
                // console.error(channelSeq + ' ' + Error(e));
                continue;
            }
            if (!response.data) {
                // console.error("couldn't fetch videos for " + channelSeq);
                continue;
            }

            let channelData = response.data["result"];
            if (!channelData) {
                // console.error("couldn't resolve channelInfo or videoList for " + channelSeq);
                continue;
            }
            let { channelInfo, videoList } = channelData;
            let { channelCode, channelProfileImage, backgroundColor } = channelInfo;

            let oldVideos = await database.getChannelVliveVideos(channelSeq);
            let oldVidSeqs = oldVideos.map(vid => vid.videoSeq);

            let newVideos = videoList.filter(vid => !oldVidSeqs.includes(vid.videoSeq)).sort((a,b) => {
                // sort videos in date order
                return new Date(a.onAirStartAt + " UTC+9:00").getTime() - new Date(b.onAirStartAt + " UTC+9:00").getTime();
            })
            let targetData = channelNotifs.filter(data => data.channelSeq == channelSeq);
            let channelColour = parseInt(backgroundColor.replace('#', ''), 16);

            for (let video of newVideos) {

                let { videoSeq, videoType, onAirStartAt, title, thumbnail, representChannelName } = video;
                let releaseTimestamp = new Date(onAirStartAt + " UTC+9:00").getTime();
                
                await database.addVideo(videoSeq, channelSeq);
                
                if (!['VOD', 'LIVE'].includes(videoType)) {
                    console.log(videoSeq + ' was a playlist');
                    continue;
                }

                let videoLive = videoType == 'LIVE';

                let embed = new Discord.MessageEmbed({
                    author: {
                        name: `${representChannelName} - ${videoLive ? 'Now Live!' : 'New Upload'}`, 
                        icon_url: channelProfileImage, 
                        url: `https://channels.vlive.tv/${channelCode}/home` 
                    },
                    title: (videoLive ? '**[LIVE]** ' : '**[VOD]** ') + title,
                    url: `https://www.vlive.tv/video/${videoSeq}/`,
                    image: { url: thumbnail + '?type=f886_499' },
                    footer: { text: 'VLIVE', icon_url: 'https://i.imgur.com/gHo7BTO.png' },
                    timestamp: releaseTimestamp,
                    color: channelColour
                });

                for (let data of targetData) {
                    let { guildID, discordChanID, mentionRoleID, VPICK } = data;

                    if (!VPICK && representChannelName == 'V PICK!') {
                        continue;
                    }

                    let guild = Client.guilds.cache.get(guildID);
                    if (!guild) {
                        // console.error(Error("Guild couldn't be retrieved to send VLIVE notif to."));
                        continue;
                    }
                    let discordChannel = Client.channels.cache.get(discordChanID) || guild.channels.cache.get(discordChanID);
                    if (!discordChannel) {
                        // console.error(Error("Channel couldn't be retrieved to send VLIVE notif to."));
                        continue;
                    }

                    let message = `https://www.vlive.tv/video/${videoSeq}/${mentionRoleID ? ` <@&${mentionRoleID}>`:``}`;

                    discordChannel.send(message, {embed}).catch(error => {
                        // console.error(Error(error));
                    });
                }   

            }

        }
    })().catch(console.error);

    console.log("Finished checking VLIVE, took " + (Date.now() - startTime) / 1000 + "s");
    setTimeout(vliveLoop, Math.max(30000 - (Date.now() - startTime), 0)); // ensure runs every 30 secs unless processing time > 30 secs

}
