const serverSettings = require("../modules/server_settings.js");

const instagram = require("../tasks/instagram.js");
const twitter = require("../tasks/twitter.js");
const vlive = require("../tasks/vlive.js");

exports.handleTasks = () => {
    
    console.log("Initialising modules...");
    serverSettings.ready();

    console.log("Starting tasks...");
    instagram.tasks();
    twitter.tasks();
    vlive.tasks();

}