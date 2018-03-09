const schedule = require('node-schedule');
const dateFormat = require('dateformat');

let Event = function(controller, bots, team) {

    this.team = team,

    this.activeEvent = {
        name: '',
        venue: '',
        dateTime: 0,
        attendees: [],
        creator: ''
    },

    this.lastPromptMessage = '',

    this.schedule5Mins = null,
    this.scheduleFinal = null,

    this.load = function(teamId) {
        let self = this;
        controller.storage.teams.get(teamId, function(err, team_data) {
            if (err) {
                console.log('Error loading config', err);
                return;
            }
            if (team_data.hasOwnProperty('activeEvent')) {
                self.activeEvent = team_data.activeEvent;
                self.setSchedule();
            }
        });
    },

    this.replaceTags = function(text) {
        text = text.replace('{name}', this.activeEvent.name);
        text = text.replace('{venue}', this.activeEvent.venue);
        text = text.replace('{date}', dateFormat(this.activeEvent.dateTime, 'dddd, dS mmmm, yyyy'));
        text = text.replace('{time}', dateFormat(this.activeEvent.dateTime, 'h:MM:ss TT'));
        text = text.replace('{attendeeCount}', this.activeEvent.attendees.length);
        text = text.replace('{creator}', '<@' + this.activeEvent.creator + '>');
        return text;
    },

    this.getFormatted = function(text, showActions) {
        if (text != '') {
            this.lastPromptMessage = text;
        }
        let defaultFormat = {
            text: this.replaceTags((text != '' ? text : this.lastPromptMessage)),
            attachments: [
                {
                    title: 'Event',
                    text: this.activeEvent.name,
                    color: '#3AA3E3',
                    attachment_type: 'default',
                    fields: [
                        {
                            title: 'Date',
                            value: dateFormat(this.activeEvent.dateTime, 'dddd, dS mmmm, yyyy'),
                            short: true
                        },
                        {
                            title: 'Time',
                            value: dateFormat(this.activeEvent.dateTime, 'h:MM:ss TT'),
                            short: true
                        },
                        {
                            title: 'Venue',
                            value: this.activeEvent.venue,
                            short: true
                        },
                        {
                            title: 'Attending So Far',
                            value: this.activeEvent.attendees.length,
                            short: true 
                        }
                    ]
                }
            ],
            response_type: 'ephemeral'
        };
        if (showActions) {
            defaultFormat.attachments[0]['actions'] = [
                {
                    name: 'attending',
                    text: ':white_check_mark: Yes, I\'m In!',
                    type: 'button',
                    value: 'attending'
                },
                {
                    name: 'not_attending',
                    text: ':x: Sorry, Not Now',
                    type: 'button',
                    value: 'not_attending'
                },
                {
                    name: 'refresh',
                    text: ':arrows_counterclockwise: Refresh',
                    type: 'button',
                    value: 'refresh'
                }
            ];
            defaultFormat.attachments[0]['callback_id'] = 'attendance';
        }
        return defaultFormat;
    },

    this.getAttendees = function() {
        if (this.activeEvent.attendees == 0) {
            return {
                text: this.replaceTags('Nobody\'s attending *{name}* right now.')
            }
        }
        let attendees = '';
        for(let i in this.activeEvent.attendees) {
            attendees += (parseInt(i) + 1) + '. <@' + this.activeEvent.attendees[i] + '>\n';
        }
        return {
            text: this.replaceTags('Here\'s a list of who\'s attending *{name}* so far:\n' + attendees)
        };
    },

    this.addAttendee = function(user) {
        if (this.activeEvent.attendees.indexOf(user) != -1) {
            return false;
        }
        this.activeEvent.attendees.push(user);
        this.save();
        return true;
    },

    this.removeAttendee = function(user) {
        if (this.activeEvent.attendees.indexOf(user) == -1) {
            return false;
        }
        this.activeEvent.attendees.splice(this.activeEvent.attendees.indexOf(user), 1);
        this.save();
        return true;
    },

    this.getCreator = function() {
        return this.activeEvent.creator;
    },

    this.isAttending = function(user) {
        return this.activeEvent.attendees.indexOf(user) != -1;
    },

    this.setActiveEvent = function(event) {
        this.activeEvent = event;
    },

    this.setName = function(name) {
        this.activeEvent.name = name;
        this.save();
    },

    this.setVenue = function(venue) {
        this.activeEvent.venue = venue;
        this.save();
    },

    this.setDateTime = function(dateTime) {
        this.activeEvent.dateTime = dateTime;
        this.save();
    },

    this.save = function() {
        let bot = bots.getByTeam(this.team);
        controller.storage.teams.save({
            id: this.team.id,
            activeEvent: this.activeEvent,
            bot: {
                token: bot.config.token,
                user_id: bot.config.user_id,
                createdBy: bot.config.createdBy
            }
        }, function(err) {
        });
        this.setSchedule();
    },

    this.setSchedule = function() {
        let self = this;
        if (!this.activeEvent.dateTime) {
            return;
        }
        if (this.schedule5Mins) {
            this.schedule5Mins.cancel();
        }
        this.schedule5Mins = schedule.scheduleJob(this.activeEvent.dateTime - (5 * 60000), function() {
            for(let i in self.activeEvent.attendees) {
                let bot = bots.getByTeam(self.team);
                bot.startPrivateConversation({
                    user: self.activeEvent.attendees[i]
                }, function(err, convo) {
                    if (err) {
                        bot.botkit.log('Could not notify', err);
                        return;
                    }
                    convo.say(self.getFormatted('Your event is starting in 5 minutes.'));
                });
            }
        });
        // Cancel event at scheduled time
        if (this.scheduleFinal) {
            this.scheduleFinal.cancel();
        }
        this.scheduleFinal = schedule.scheduleJob(this.activeEvent.dateTime, function() {
            self.cancel();
        });
    },

    this.cancel = function() {
        this.activeEvent = {
            name: '',
            venue: '',
            dateTime: 0,
            attendees: [],
            creator: ''
        };
        this.save();
    },

    this.isScheduled = function() {
        return this.activeEvent.name != '';
    },

    this.isCreator = function(user) {
        return this.activeEvent.creator == user;
    }

    // Preload events
    this.load(this.team.id);

};

module.exports = Event;
