# Attendigo

1. Create an .env file
2. Add keys:

```
SLACK_TOKEN=<token>
SLACK_CLIENT_ID=<client_id>
SLACK_CLIENT_SECRET=<client_secret>
SLACK_BASE_URL=<base_url>
SLACK_PORT=443
SLACK_WEBHOOK_SSL_ENABLED=0
SLACK_WEBHOOK_SSL_KEY=
SLACK_WEBHOOK_SSL_CERT=
SLACK_WEBHOOK_SSL_CA_BUNDLE=
```

Get the `SLACK_TOKEN` value from the [Slack new bot page](https://my.slack.com/services/new/bot).

Grab the `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` values from the [Slack app registration page](https://api.slack.com/apps?new_app=1).

Enter your local URL in `SLACK_BASE_URL`. It must be an HTTPS connection. BotKit comes with its own local Express server running an OAuth endpoint. You can either manually load SSL keys and certs (via `SLACK_WEBHOOK_SSL*` environment variables), or use a program like [ngrok.io](https://ngrok.io) with command `ngrok http -subdomain=attendigo 443`. This will create a domain like `attendigo.ngrok.io` serving via port 443.

You will need to configure the following settings in your app:

- Interactive Components (*Request URL* should be https://your.domain:443/slack/receive)
- OAuth & Permissions (*Redirect URLs* should be https://your.domain:443)

Open https://your.domain:443/login in your browser to start the OAuth process.

Run:

```
npm install
sudo node attendigo.js
```

Attendigo will run an Express web server on port 443.