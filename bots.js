const Event = require('./event.js');

let Bots = {

    teams: {},
    activeEvents: {},

    addBot: function(controller, bot) {
        this.teams[bot.team_info.id] = bot;
        this.activeEvents[bot.config.token] = new Event(controller, this, bot.team_info);
    },

    isLoaded: function(bot) {
        return this.activeEvents.hasOwnProperty(bot.config.token);
    },

    getActiveEvent: function(bot) {
        return this.activeEvents[bot.config.token];
    },

    getByTeam: function(team) {
        return this.teams[team.id];
    }

};

module.exports = Bots;
