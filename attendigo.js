/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

 @ ATTENDIGO
 # Slack bot for managing events

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/

require('dotenv').config();

if (!process.env.SLACK_TOKEN) {
    console.log('Error: Specify token in environment');
    process.exit(1);
}

const os = require('os');
const chrono = require('chrono-node');
const dateFormat = require('dateformat');
const Botkit = require('./lib/Botkit.js');
// Custom modules:
const Bots = require('./bots.js');

const controller = Botkit.slackbot({
    json_file_store: 'attendigo.json',
    retry: Infinity,
    debug: true,
});

controller.storage.teams.all(function(err, teams) {
    if (err) {
        throw new Error(err);
    }
    for (let t in teams) {
        if (teams[t].bot) {
            teams[t].retries = 500;
            console.log('Starting with ', teams[t]);
            let spawn = controller.spawn(teams[t]).startRTM(function(err, bot) {
                if (err) {
                    console.log('Error connecting bot to Slack:', err);
                } else {
                    Bots.addBot(controller, bot);
                    controller.setWebhookIdentity(bot.identity);
                }
            });
        }
    };
});

controller.configureSlackApp({
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    redirectUri: process.env.SLACK_BASE_URL + ':' + process.env.SLACK_PORT + '/oauth',
    scopes: ['bot']
});

// Set up a botkit app to expose oauth and webhook endpoints
controller.setupWebserver(process.env.SLACK_PORT, function(err, webserver) {

    // Set up web endpoints for oauth, receiving webhooks, etc.
    controller
        .createHomepageEndpoint(controller.webserver)
        .createOauthEndpoints(controller.webserver, function(err, req, res) {
            if (err) {
                res.status(500).send('ERROR: ' + err);
            } else {
                res.send('Success!');
            }
        })
        .createWebhookEndpoints(controller.webserver);

}, process.env.SLACK_WEBHOOK_SSL_ENABLED == '1' ? {
    ssl_certificates: {
        key: process.env.SLACK_WEBHOOK_SSL_KEY,
        cert: process.env.SLACK_WEBHOOK_SSL_CERT,
        ca_bundle: process.env.SLACK_WEBHOOK_SSL_CA_BUNDLE,
    }
} : {});

// Reschedule an existing event
controller.hears(['reschedule', 'rename', 'change', 'venue', 'update'], 'direct_message,direct_mention,mention', function(bot, message) {

    let activeEvent = Bots.getActiveEvent(bot);

    if (!activeEvent.isScheduled()) {
        bot.reply(message, 'Nothing\'s been scheduled yet. To schedule an event, say `' + (message.event === 'direct_message' ? '' : '<@' + bot.identity.name + '> ') + 'create`.');
        return;
    }
    if (!activeEvent.isCreator(message.user)) {
        bot.reply(message, activeEvent.replaceTags('Sorry, only the event\'s creator ({creator}) can change the event.'));
        return;
    }

    if (message.text.match(/reschedule/)) {
        let newTime = 0;
        bot.startPrivateConversation(message, function(err, convo) {
            if (err) {
                bot.botkit.log('Could not respond', err);
                return;
            }
            convo.ask(activeEvent.replaceTags('When would you like to reschedule *{name}* for? Say `exit` to cancel editing.'), [
                {
                    pattern: 'exit',
                    callback: function(response, convo) {
                        convo.stop();
                    }
                },
                {
                    default: true,
                    callback: function(response, convo) {
                        try {
                            let parsedDate = chrono.parse(response.text);
                            try {
                                newTime = parsedDate[0].start.date().getTime();
                                convo.next();
                            } catch(err) {
                                bot.reply(convo.source_message, 'Sorry, I didn\'t understand that. Try say something like `next Tuesday at 3pm`.');
                                convo.silentRepeat();
                            }
                        } catch(err) {
                            bot.reply(convo.source_message, 'Sorry, I didn\'t understand that. Try say something like `next Tuesday at 3pm`.');
                            convo.silentRepeat();
                        }
                    }
                }
            ]);
            convo.on('end', function(convo) {
                if (convo.status == 'stopped') {
                    bot.reply(message, 'Next time, perhaps.');
                } else {
                    activeEvent.setDateTime(newTime);
                    bot.reply(message, activeEvent.getFormatted('Your event has been rescheduled.'));
                }
            });
        });
    } else
    if (message.text.match(/rename/)) {
        let newName = '';
        bot.startPrivateConversation(message, function(err, convo) {
            if (err) {
                bot.botkit.log('Could not respond', err);
                return;
            }
            convo.ask(activeEvent.replaceTags('What would you like to rename *{name}* to? Say `exit` to cancel editing.'), [
                {
                    pattern: 'exit',
                    callback: function(response, convo) {
                        convo.stop();
                    }
                },
                {
                    default: true,
                    callback: function(response, convo) {
                        newName = response.text;
                        convo.next();
                    }
                }
            ]);
            convo.on('end', function(convo) {
                if (convo.status == 'stopped') {
                    bot.reply(message, 'Next time, perhaps.');
                } else {
                    activeEvent.setName(newName);
                    bot.reply(message, activeEvent.getFormatted('Your event has been renamed.'));
                }
            });
        });
    } else
    if (message.text.match(/venue/)) {
        let newVenue = '';
        bot.startPrivateConversation(message, function(err, convo) {
            if (err) {
                bot.botkit.log('Could not respond', err);
                return;
            }
            convo.ask(activeEvent.replaceTags('Where will *{name}* be held now? Say `exit` to cancel editing.'), [
                {
                    pattern: 'exit',
                    callback: function(response, convo) {
                        convo.stop();
                    }
                },
                {
                    default: true,
                    callback: function(response, convo) {
                        newVenue = response.text;
                        convo.next();
                    }
                }
            ]);
            convo.on('end', function(convo) {
                if (convo.status == 'stopped') {
                    bot.reply(message, 'Next time, perhaps.');
                } else {
                    activeEvent.setVenue(newVenue);
                    bot.reply(message, activeEvent.getFormatted('Your event\'s venue has been changed.'));
                }
            });
        });
    }

});

// Create a new event
controller.hears(['schedule', 'set up', 'setup', 'create', 'new', 'book'], 'direct_message,direct_mention,mention', function(bot, message) {

    let activeEvent = Bots.getActiveEvent(bot);

    if (activeEvent.isScheduled()) {
        bot.reply(message, 'There\'s already an upcoming event scheduled. Please `' + (message.event === 'direct_message' ? '' : '<@' + bot.identity.name + '> ') + 'cancel` that one before adding a new one.');
        return;
    }

    let userName;
    let newEvent = {
        name: '',
        venue: '',
        dateTime: 0,
        attendees: [
            message.user
        ],
        creator: message.user
    };
    bot.api.users.info({ user: message.user }, (error, response) => {
        if ((error) || (typeof response.user.profile.first_name === 'undefined')) {
            userName = 'there';
        } else {
            userName = response.user.profile.first_name;
        }
        if (message.event !== 'direct_message') {
            bot.reply(message, 'Hey ' + userName + ', I\'ve opened a private chat so I can get further details about your event.');
        }
        bot.startPrivateConversation(message, function(err, convo) {
            if (err) {
                bot.botkit.log('Could not respond', err);
                return;
            }
            convo.ask((message.event !== 'direct_message' ? 'Okay' : 'Hey ' + userName) + ', let\'s get your event set up. You can say `exit` at any time to exit the setup.\nWhat\'s the event called?', [
                {
                    pattern: 'exit',
                    callback: function(response, convo) {
                        convo.stop();
                    }
                },
                {
                    default: true,
                    callback: function(response, convo) {
                        newEvent.name = response.text;
                        convo.setVar('eventName', response.text);
                        convo.next();
                    }
                }
            ]);
            convo.ask('Where will it be held?', [
                {
                    pattern: 'exit',
                    callback: function(response, convo) {
                        convo.stop();
                    }
                },
                {
                    default: true,
                    callback: function(response, convo) {
                        newEvent.venue = response.text;
                        convo.next();
                    }
                }
            ]);
            convo.ask('And finally, when will *{{vars.eventName}}* be running? You can say something like `next Tuesday at 3pm`.', [
                {
                    pattern: 'exit',
                    callback: function(response, convo) {
                        convo.stop();
                    }
                },
                {
                    default: true,
                    callback: function(response, convo) {
                        // @todo: check/handle invalid date formats
                        try {
                            let parsedDate = chrono.parse(response.text);
                            try {
                                let dateParsed = dateFormat(parsedDate[0].start.date(), 'dddd, dS mmmm, yyyy');
                                let timeParsed = dateFormat(parsedDate[0].start.date(), 'h:MM:ss TT');
                                newEvent.dateTime = parsedDate[0].start.date().getTime();
                                convo.next();
                            } catch(err) {
                                bot.reply(convo.source_message, 'Sorry, I didn\'t understand that. Try say something like `next Tuesday at 3pm`.');
                                convo.silentRepeat();
                            }
                        } catch(err) {
                            bot.reply(convo.source_message, 'Sorry, I didn\'t understand that. Try say something like `next Tuesday at 3pm`.');
                            convo.silentRepeat();
                        }
                    }
                }
            ]);
            convo.on('end', function(convo) {
                if (convo.status == 'stopped') {
                    bot.reply(message, 'Okay, no hard feelings!');
                } else {
                    activeEvent.setActiveEvent(newEvent);
                    activeEvent.save();
                    bot.reply(message, activeEvent.getFormatted('Your event has been scheduled.\nTo invite everyone in a channel, say `invite #channel`. To invite specific people, say `invite @username`. You can also see a list of attendees at any time by saying `attendees`.'));
                }
            });
        });

    });

});

// Create a new event
controller.hears(['invite', 'invitations'], 'direct_message,direct_mention,mention', function(bot, message) {

    let activeEvent = Bots.getActiveEvent(bot);

    let userRx = /<@([A-Z0-9]{9})>/g;
    let channelRx = /<#([A-Z0-9]{9})\|([A-Za-z0–9_]+)>/g;
    let users = [];
    let channels = [];
    let match;

    if (!activeEvent.isScheduled()) {
        bot.reply(message, 'Nothing\'s been scheduled yet. To schedule an event, say `' + (message.event === 'direct_message' ? '' : '<@' + bot.identity.name + '> ') + 'create`.');
        return;
    }
    if (!activeEvent.isCreator(message.user)) {
        bot.reply(message, activeEvent.replaceTags('Sorry, only the event\'s creator ({creator}) can send invitations out.'));
        return;
    }

    match = userRx.exec(message.text);
    while (match != null) {
        let user = match[1];
        if (user === message.user) {
            bot.reply(message, 'You can\'t invite yourself!');
            return;
        }
        bot.startPrivateConversation({
            user: user
        }, function(err, convo) {
            if (err) {
                bot.botkit.log('User not found', user);
                return;
            }
            convo.say(Object.assign(activeEvent.getFormatted('{creator} has invited you to the following event. Will you be attending?', true), {}));
        });
        match = userRx.exec(message.text);
        users.push(user);
    }

    match = channelRx.exec(message.text);
    while (match != null) {
        let channel = match[1];
        bot.say(Object.assign(activeEvent.getFormatted('{creator} has invited you to the following event.', true), {
            channel: channel
        }));
        match = channelRx.exec(message.text);
        channels.push(channel);
    }

    if ((users.length) || (channels.length)) {
        bot.reply(message, 'Okay, I\'ve sent your invitations. To see a list of attendees at any time, say `' + (message.event === 'direct_message' ? '' : '<@' + bot.identity.name + '> ') + 'attendees`.');
    } else {
        bot.reply(message, 'You didn\'t say who to invite. To invite everyone in a channel, say `' + (message.event === 'direct_message' ? '' : '<@' + bot.identity.name + '> ') + 'invite #channel`. To invite specific people, say `' + (message.event === 'direct_message' ? '' : '<@' + bot.identity.name + '> ') + 'invite @username`.')
    }

});

// List active event
controller.hears(['cancel'], 'direct_message,direct_mention,mention', function(bot, message) {

    let activeEvent = Bots.getActiveEvent(bot);

    if (!activeEvent.isScheduled()) {
        bot.reply(message, 'Nothing\'s been scheduled yet. To schedule an event, say `' + (message.event === 'direct_message' ? '' : '<@' + bot.identity.name + '> ') + 'create`.');
        return;
    }
    if (!activeEvent.isCreator(message.user)) {
        bot.reply(message, activeEvent.replaceTags('Sorry, only the event\'s creator ({creator}) can cancel the event.'));
        return;
    }

    bot.reply(message, {
        attachments: [
            {
                title: activeEvent.replaceTags('Are you sure you want to cancel {name}?'),
                callback_id: 'cancel',
                attachment_type: 'default',
                actions: [
                    {
                        name: "no",
                        text: "No, I made a mistake",
                        value: "no",
                        type: "button"
                    },
                    {
                        name: "yes",
                        text: "Yes, cancel it!",
                        value: "yes",
                        type: "button",
                        style: "danger",
                        confirm: {
                            title: "Are you sure?",
                            text: "Cancelling the event cannot be undone.",
                            ok_text: "Yes, cancel it",
                            dismiss_text: "No, I changed my mind!"
                        }
                    }
                ]
            }
        ]
    });

});

// List active event
controller.hears(['upcoming', 'events', 'happening', 'list'], 'direct_message,direct_mention,mention', function(bot, message) {

    let activeEvent = Bots.getActiveEvent(bot);

    if (!activeEvent.isScheduled()) {
        bot.reply(message, 'Nothing\'s been scheduled yet. To schedule an event, say `' + (message.event === 'direct_message' ? '' : '<@' + bot.identity.name + '> ') + 'create`.');
    } else {
        bot.reply(message, Object.assign(activeEvent.getFormatted('Here\'s what\'s coming up next:', true), {}));
    }

});

// Indicate you're not attending
controller.hears(['remove', 'no', 'nah', 'nope', 'not attending', 'not coming', 'won\'t be coming', 'won\'t be attending', 'count me out'], 'direct_message,direct_mention,mention', function(bot, message) {

    let activeEvent = Bots.getActiveEvent(bot);

    if (!activeEvent.isScheduled()) {
        bot.reply(message, 'Nothing\'s been scheduled yet. To schedule an event, say `' + (message.event === 'direct_message' ? '' : '<@' + bot.identity.name + '> ') + 'create`.');
        return;
    }

    let userRx = /<@([A-Z0-9]{9})>/g;
    let users = [];

    let match = userRx.exec(message.text);
    while (match != null) {
        users.push(match[1]);
        match = userRx.exec(message.text);
    }
    if (users.length) {
        if (activeEvent.isCreator(message.user)) {
            for(let i in users) {
                activeEvent.removeAttendee(users[i]);
            }
            bot.reply(message, activeEvent.replaceTags('Okay, I have removed them from the attendee list.'));
        } else {
            bot.reply(message, activeEvent.replaceTags('Sorry, only the event\'s creator ({creator}) can remove attendees.'));
        }
    } else {
        activeEvent.removeAttendee(message.user);
        bot.reply(message, activeEvent.replaceTags('Bummer, see you next time?\nIf you change your mind, please let me know by saying `' + (message.event === 'direct_message' ? '' : '<@' + bot.identity.name + '> ') + 'rsvp yes`.'));
        if (!activeEvent.isCreator(message.user)) {
            bot.startPrivateConversation({
                user: activeEvent.getCreator()
            }, function(err, convo) {
                if (err) {
                    bot.botkit.log('Could not engage', err);
                    return;
                }
                convo.say(activeEvent.replaceTags('Oh no! <@' + message.user + '> won\'t be attending *{name}* :sob:'));
            });
        }
    }

});

// Indicate you're attending
controller.hears(['add', 'yes', 'yep', 'yea', 'ya', 'sure', 'ok', 'yeah', 'yah', 'coming', 'i\'m in', 'i\'ll be there', 'be attending', 'count me in'], 'direct_message,direct_mention,mention', function(bot, message) {

    let activeEvent = Bots.getActiveEvent(bot);

    if (!activeEvent.isScheduled()) {
        bot.reply(message, 'Nothing\'s been scheduled yet. To schedule an event, say `' + (message.event === 'direct_message' ? '' : '<@' + bot.identity.name + '> ') + 'create`.');
        return;
    }

    let userRx = /<@([A-Z0-9]{9})>/g;
    let users = [];

    let match = userRx.exec(message.text);
    while (match != null) {
        users.push(match[1]);
        match = userRx.exec(message.text);
    }
    if (users.length) {
        if (activeEvent.isCreator(message.user)) {
            for(let i in users) {
                activeEvent.addAttendee(users[i]);
            }
            bot.reply(message, activeEvent.replaceTags('Okay, I have added them to the attendee list.'));
        } else {
            bot.reply(message, activeEvent.replaceTags('Sorry, only the event\'s creator ({creator}) can add attendees.'));
        }
    } else {
        activeEvent.addAttendee(message.user);
        bot.reply(message, activeEvent.replaceTags('Looking forward to seeing you at *{name}*!\nIf you change your mind, please let me know by saying `' + (message.event === 'direct_message' ? '' : '<@' + bot.identity.name + '> ') + 'rsvp no`.'));
        if (!activeEvent.isCreator(message.user)) {
            bot.startPrivateConversation({
                user: activeEvent.getCreator()
            }, function(err, convo) {
                if (err) {
                    bot.botkit.log('Could not engage', err);
                    return;
                }
                convo.say(activeEvent.replaceTags('Great news! <@' + message.user + '> will be attending *{name}* :tada:'));
            });
        }
    }

});

// Get a list of attendees
controller.hears(['attendees', 'attendance', 'attending'], 'direct_message,direct_mention,mention', function(bot, message) {

    let activeEvent = Bots.getActiveEvent(bot);

    if (!activeEvent.isScheduled()) {
        bot.reply(message, 'Nothing\'s been scheduled yet. To schedule an event, say `' + (message.event === 'direct_message' ? '' : '<@' + bot.identity.name + '> ') + 'create`.');
    } else {
        bot.reply(message, activeEvent.getAttendees());
    }

});

// Help
controller.hears(['help', 'hello', 'hi'], 'direct_message,direct_mention,mention', function(bot, message) {

    let userName;

    bot.api.users.info({ user: message.user }, (error, response) => {
        if ((error) || (typeof response.user.profile.first_name === 'undefined')) {
            userName = 'there';
        } else {
            userName = response.user.profile.first_name;
        }
        bot.reply(message, {
            text: 'Hey ' + userName + ', I\'m <https://api.attendigo.com:9987/|Attendigo>. Here are some phrases you can use to get started:',
            attachments: [
                {
                    text: '`create` - schedule an event\n\
`upcoming` - see what\'s schedule next\n\
`attendees` - see who\'s attending the next event',
                    color: '#3AA3E3',
                    attachment_type: 'default',
                    mrkdwn_in: ['text']
                },
                {
                    text: '`invite` - invite someone to an event you have created\n\
`reschedule` - change the event\'s date or time\n\
`rename` - change the event\'s name\n\
`change venue` - change the event\'s venue\n\
`cancel` - cancel the event',
                    color: '#3AA3E3',
                    attachment_type: 'default',
                    mrkdwn_in: ['text']
                },
                {
                    text: '`rsvp yes` - indicate that you\'re attending the event\n\
`rsvp no` - indicate that you\'re *not* attending the event\n\
`help` - this message',
                    color: '#3AA3E3',
                    attachment_type: 'default',
                    mrkdwn_in: ['text']
                }
            ]
        });
    });

});

// All other mentions or direct messages
controller.hears('.*', 'direct_message,direct_mention,mention', function(bot, message) {

    bot.reply(message, 'Sorry, I didn\'t understand that. I\'m not one of those _smart_ bots. Try say `' + (message.event === 'direct_message' ? '' : '<@' + bot.identity.name + '> ') + 'help` to get a list of words I understand.');

});

controller.on('interactive_message_callback', function(bot, message) {

    let activeEvent = Bots.getActiveEvent(bot);
    let choice;

    let callback_id = message.callback_id;
    switch(callback_id) {
        case 'attendance':
            choice = message.actions[0].value;
            switch(choice) {
                case 'attending':
                    activeEvent.addAttendee(message.user);
                    bot.replyInteractive(message, activeEvent.getFormatted('', true));
                    bot.replyInteractive(message, {
                        text: activeEvent.replaceTags('Looking forward to seeing you at *{name}*!'),
                        replace_original: false,
                        response_type: 'ephemeral'
                    });
                    bot.startPrivateConversation({
                        user: activeEvent.getCreator()
                    }, function(err, convo) {
                        if (err) {
                            bot.botkit.log('Could not engage', err);
                            return;
                        }
                        convo.say(activeEvent.replaceTags('Great news! <@' + message.user + '> will be attending *{name}* :tada:'));
                    });
                    break;
                case 'not_attending':
                    activeEvent.removeAttendee(message.user);
                    bot.replyInteractive(message, activeEvent.getFormatted('', true));
                    bot.replyInteractive(message, {
                        text: activeEvent.replaceTags('Bummer, see you next time?'),
                        replace_original: false,
                        response_type: 'ephemeral'
                    });
                    bot.startPrivateConversation({
                        user: activeEvent.getCreator()
                    }, function(err, convo) {
                        if (err) {
                            bot.botkit.log('Could not engage', err);
                            return;
                        }
                        convo.say(activeEvent.replaceTags('Oh no! <@' + message.user + '> won\'t be attending *{name}* :sob:'));
                    });
                    break;
                case 'refresh':
                    bot.replyInteractive(message, activeEvent.getFormatted('', true));
                    break;
            }
            break;
        case 'cancel':
            if (!activeEvent.isCreator(message.user)) {
                bot.replyInteractive(message, activeEvent.replaceTags('Sorry <@' + message.user + '>, only the event\'s creator ({creator}) can cancel the event.'));
                return;
            }
            choice = message.actions[0].value;
            switch(choice) {
                case 'no':
                    bot.replyInteractive(message, 'Phew! You had me going for a minute :sweat_smile:');
                    break;
                case 'yes':
                    activeEvent.cancel();
                    bot.replyInteractive(message, 'Your event has been cancelled :sob:');
            }
            break;
    }

});

controller.on('create_bot', function(bot, config) {

    if (Bots.isLoaded(bot)) {
        // Do nothing
    } else {
        bot.startRTM(function(err) {
            if (!err) {
                Bots.addBot(controller, bot);
                // Add a blank record for this team
                controller.storage.teams.save({
                    id: bot.team_info.id,
                    activeEvent: {
                        name: '',
                        venue: '',
                        dateTime: 0,
                        attendees: [],
                        creator: ''
                    },
                    bot: {
                        token: bot.config.token,
                        user_id: bot.config.user_id,
                        createdBy: bot.config.createdBy
                    }
                });
            }
            bot.startPrivateConversation({
                user: config.createdBy
            }, function(err, convo) {
                if (err) {
                    console.log(err);
                } else {
                    convo.say('I\'m a vampire. Please /invite me to your channel or I can\'t come in!');
                }
            });
        });
    }

});