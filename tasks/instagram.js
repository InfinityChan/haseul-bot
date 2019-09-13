// Import modules

const Client = require("../haseul.js").Client;

const imgMod = require("../functions/images.js");
const database = require("../db_queries/instagram_db.js");

const {
    instagram, 
    graphql, 
    timeline_hash, 
    stories_hash, 
    login
} = require("../utils/instagram.js");

// Consts

const HOST = 'haseulbot.xyz';

// Task loop

exports.tasks = async function() {

    await login();
    instaLoop().catch(console.error);
    storyCleanup().catch(console.error);

}

// Task

async function instaLoop() {

    let startTime = Date.now();

    console.log("Started checking Instagram at " + new Date(startTime).toUTCString());

    let accounts = new Map();
    let channelNotifs = await database.get_all_insta_channels();
    let instaIDs = new Set(channelNotifs.map(x => x.instaID));
    let promises = [];

    await (async () => {
        for (let instaID of instaIDs.values()) {

            let targetData = channelNotifs.filter(data => data.instaID == instaID);   
            
            promises.push((async function processPosts() {

                let response;
                try {
                    response = await graphql.get('/query/', { params: {query_hash: timeline_hash, variables: {id: instaID, first: 20}} });
                } catch(e) {
                    console.error("Instagram posts error: " + (e.response ? e.response.status : e));
                    return;
                }

                let data = response.data.data;
                if (!data) {
                    console.error("couldn't resolve recent Instagram posts for " + instaID);
                    return;
                }
                let recentPosts = data.user['edge_owner_to_timeline_media'].edges.map(edge => edge.node);

                let oldPosts = await database.get_account_posts(instaID);
                let oldPostIDs = oldPosts.map(p => p.postID);

                let newPosts = recentPosts.filter(post => !oldPostIDs.includes(post.id)).sort((a,b) => a.taken_at_timestamp - b.taken_at_timestamp) /*sort posts in date order*/
                
                for (let post of newPosts) {

                    let { id, shortcode, owner, taken_at_timestamp } = post;
                    let caption = post.edge_media_to_caption.edges;
                    caption = caption.length > 0 ? caption[0].node.text : undefined;
                    let timestamp = parseInt(taken_at_timestamp) * 1000;
                    let type = post['__typename'];
        
                    let user = accounts.get(instaID);
                    if (!user) {
                        let response;
                        try {
                            response = await instagram.get(`/${owner.username}/`, { params: {'__a': 1} });
                            user = response.data.graphql.user;
                            user = { full_name: user.full_name, profile_pic: user.profile_pic_url, username: user.username };
                            accounts.set(instaID, user);
                        } catch(e) {
                            console.error(e);
                        }
                    }
        
                    await database.add_post(instaID, id);
        
                    for (let data of targetData) {
                        let { guildID, channelID, mentionRoleID } = data;
        
                        let guild = Client.guilds.get(guildID);
                        if (!guild) {
                            console.error(Error("Guild couldn't be retrieved to send VLIVE notif to."));
                            continue;
                        }
                        let channel = Client.channels.get(channelID) || guild.channels.get(channelID);
                        if (!channel) {
                            console.error(Error("Channel couldn't be retrieved to send VLIVE notif to."));
                            continue;
                        }
        
                        let message = `https://www.instagram.com/p/${shortcode}/${mentionRoleID ? ` <@&${mentionRoleID}>`:``}`;
        
                        let options;
                        let embed = {
                            author: {
                                name: user ? `${user.full_name} (@${user.username})` : owner.username,
                                url: `https://www.instagram.com/${owner.username}/`
                            },
                            title: `New ${type == "GraphImage" ? "Photo" : type == "GraphVideo" ? "Video" : "Post"}`,
                            fields: [],
                            color: 0xffffff,
                            url: `https://www.instagram.com/p/${shortcode}/`,
                            footer: { icon_url: 'https://i.imgur.com/NNzsisb.png', text: 'Instagram' },
                            timestamp
                        }
                        
                        if (caption) {
                            let captionHyperlinked = caption.replace(/@([^ \n!-/:-@[-^`\{-~]+)/gi, `[@$1](https://www.instagram.com/$1/ "View @$1 on Instagram")`)
                                                            .replace(/#([^ \n!-/:-@[-^`\{-~]+)/gi, `[#$1](https://www.instagram.com/explore/tags/$1/ "Explore #$1 on Instagram")`).replace(/(\n\.)+/, '\n');
                            caption = captionHyperlinked.length <= 2048 ? captionHyperlinked : caption;
                            embed.description = caption.replace(/(?<!\(https?:\/\/.+\s"View\s#[^ \n!-/:-@[-^`\{-~]+)([`\*~_])(?!\son\sInstagram")/g, "\\$&");
                        }
                        if (user) embed.author.icon_url = user.profile_pic;
                        if (type == "GraphSidecar") {
                            let sidecar = post.edge_sidecar_to_children.edges;
                            let images = sidecar.filter(c => c.node['__typename'] == 'GraphImage').map(i => i.node);
                            let videos = sidecar.filter(c => c.node['__typename'] == 'GraphVideo').map(v => v.node);
                            if (images.length < 1) {
                                embed.image = { url: videos[0].display_url };
                                options = { embed };
                            } else if (images.length < 2) {
                                embed.image = { url: images[0].display_url };
                                options = { embed };
                            } else {
                                let collage = await imgMod.createMediaCollage(images.map(i => i.display_url), 900, 600, 600, 300);
                                let files = [{attachment: collage, name: `${shortcode}-media-collage.png`}];
                                embed.image = { url: 'attachment://' + files[0].name};
                                options = { embed, files };
                            }
        
                            if (images.length > 0) {
                                let field = "";
                                for (let i = 0; i < images.length; i++) {
                                    let { id, display_url } = images[i];
                                    await database.add_custom_image(id, display_url);
                                    let link = `http://${HOST}/insta/img/${id}`;
                                    let text = ` [\`${i+1}\`:frame_photo:](${link} "Click to View Image")`;
                                    if (field.length + text.length > 1024) {
                                        field += '.'.repeat(Math.min(3, 1024 - field.length));
                                        break;
                                    } else {
                                        field += text;
                                    }
                                }
                                embed.fields.push({ name: 'Image Links', value: field.trim(), inline: true });
                            }
                            if (videos.length > 0) {
                                let field = "";
                                for (let i = 0; i < videos.length; i++) {
                                    let { id, video_url} = videos[i];
                                    await database.add_custom_video(id, video_url);
                                    let link = `http://${HOST}/insta/vid/${id}`;
                                    let text = ` [\`${i+1}\`:film_frames:](${link} "Click to Watch Video")`;
                                    if (field.length + text.length > 1024) {
                                        field += '.'.repeat(Math.min(3, 1024 - field.length));
                                        break;
                                    } else {
                                        field += text;
                                    }
                                }
                                embed.fields.push({ name: 'Video Links', value: field.trim(), inline: true });
                            }
                        }
        
                        if (type == "GraphImage") {
                            embed.image = { url: post.display_url };
                            options = { embed };
                        }
        
                        if (type == "GraphVideo") {
                            embed.image = { url: post.display_url };
                            embed.fields.push({ name: 'Video Link', value: `[\`>\`:film_frames:\`<\`](${post.video_url} "Click to Watch Video")` });
                            options = { embed };
                        }
                        
                        channel.send(message, options).catch(console.error);
                    }            
        
                }

            })());
            
            promises.push((async function processStories() {

                let LOGGED_IN = false;
                for (let i = 0; i < 3 && !LOGGED_IN; i++) {
                    let { csrf_token, cookie } = require("../utils/instagram.js").credentials;
                    try {
                        response = await graphql.get('/query/', { 
                            params: {
                                query_hash: stories_hash, 
                                variables: {
                                    reel_ids: [instaID], precomposed_overlay: false, show_story_viewer_list: false, stories_video_dash_manifest: false 
                                }
                            },
                            headers: { 'X-CSRFToken': csrf_token, 'Cookie': cookie }
                        });
                        LOGGED_IN = true;
                    } catch(e) {
                        if (e.response) {
                            switch (e.response.status) {
                                case 403:
                                    await login();
                                    break;
                                case 429:
                                    console.error("Instagram stories error, code: " + e.response.status);
                                    return;
                                default:
                                    console.error("Instagram stories error, code: " + e.response.status);
                                    LOGGED_IN = true;
                                    break;
                            }
                        } else {
                            console.error("Instagram stories error: " + e);
                        }
                    }
                }
                if (!LOGGED_IN) {
                    console.error("Couldn't log in to Instagram after 3 attempts... skipping account");
                    return;
                }

                let storyReel = response.data.data['reels_media'];
                if (storyReel.length < 1) {
                    return;
                }
                let recentStories = storyReel[0].items;

                let oldStories = await database.get_account_stories(instaID);
                let oldstoryIDs = oldStories.map(s => s.storyID);

                let newStories = recentStories.filter(story => !oldstoryIDs.includes(story.id)).sort((a,b) => a.taken_at_timestamp - b.taken_at_timestamp) /*sort stories in date order*/

                for (let story of newStories) {

                    let { id, owner, display_url, taken_at_timestamp, expiring_at_timestamp} = story;

                    let timestamp = parseInt(taken_at_timestamp) * 1000;
                    let type = story['__typename'];

                    let user = accounts.get(instaID);
                    if (!user) {
                        let response;
                        try {
                            response = await instagram.get(`/${owner.username}/`, { params: {'__a': 1} });
                            user = response.data.graphql.user;
                            user = { full_name: user.full_name, profile_pic: user.profile_pic_url, username: user.username };
                            accounts.set(instaID, user);
                        } catch(e) {
                            console.error(e);
                        }
                    }

                    await database.add_story(instaID, id, expiring_at_timestamp);

                    for (let data of targetData) {
                        let { guildID, channelID, mentionRoleID, stories } = data;

                        if (!stories) {
                            continue;
                        }

                        let guild = Client.guilds.get(guildID);
                        if (!guild) {
                            console.error(Error("Guild couldn't be retrieved to send VLIVE notif to."));
                            continue;
                        }
                        let channel = Client.channels.get(channelID) || guild.channels.get(channelID);
                        if (!channel) {
                            console.error(Error("Channel couldn't be retrieved to send VLIVE notif to."));
                            continue;
                        }

                        let message = `https://www.instagram.com/stories/${owner.username}/${mentionRoleID ? ` <@&${mentionRoleID}>`:``}`;

                        let embed = {
                            author: {
                                name: user ? `${user.full_name} (@${user.username})` : owner.username,
                                url: `https://www.instagram.com/${owner.username}/`
                            },
                            title: "New Story",
                            fields: [],
                            color: 0xe64c5b,
                            image: { url: display_url },
                            url: `https://www.instagram.com/stories/${owner.username}/`,
                            footer: { icon_url: 'https://i.imgur.com/NNzsisb.png', text: 'Instagram Stories' },
                            timestamp
                        }
                        if (user) embed.author.icon_url = user.profile_pic;

                        if (type == "GraphStoryVideo") {
                            let { video_resources } = story;
                            embed.description = `[\\▶ Video Link](${video_resources[video_resources.length - 1].src } "Click to Watch Video")`
                        }

                        channel.send(message, {embed}).catch(console.error);
                    }
                    
                }

            })())

        }
        await Promise.all(promises);
    })().catch(console.error);
    

    console.log("Finished checking Instagram, took " + (Date.now() - startTime) / 1000 + "s");
    let waitTime = Math.max(60000 - (Date.now() - startTime), 4000 * instaIDs.size, 0);
    setTimeout(instaLoop, waitTime); // ensure runs every 60 secs unless processing time > 60 secs

}

async function storyCleanup() {

    let startTime = Date.now();
    console.log("Started cleaning out old Instagram stories at " + new Date(startTime).toUTCString());
    await database.clear_old_stories();
    console.log("Finished cleaning out old Instagram stories, took " + (Date.now() - startTime) / 1000 + "s");
    let waitTime = Math.max(1000 * 60 * 60 - (Date.now() - startTime), 0); // hourly
    setTimeout(storyCleanup, waitTime);

}
