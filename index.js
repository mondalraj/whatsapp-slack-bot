"use strict";

const token = process.env.WHATSAPP_TOKEN;

const request = require("request"),
  express = require("express"),
  body_parser = require("body-parser"),
  axios = require("axios").default;

const { WebClient } = require("@slack/web-api");
const { createEventAdapter } = require("@slack/events-api");
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const slackEvents = createEventAdapter(slackSigningSecret);

const app = express(); // creates express http server
app.use("/slack/events", slackEvents.requestListener());

app.use(body_parser.json());

// Sets server port and logs message on success
app.listen(process.env.PORT || 1337, () => console.log("webhook is listening"));

// WebClient instantiates a client that can call API methods
const client = new WebClient(process.env.SLACK_TOKEN);

// Accepts POST requests at /webhook endpoint
app.post("/webhook", async (req, res) => {
  let body = req.body;

  // console.log(JSON.stringify(req.body, null, 2));
  console.log(res)

  // info on WhatsApp text message payload: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples#text-messages
  if (req.body.object) {
    if (
      req.body.entry &&
      req.body.entry[0].changes &&
      req.body.entry[0].changes[0] &&
      req.body.entry[0].changes[0].value.messages &&
      req.body.entry[0].changes[0].value.messages[0]
    ) {
      let phone_number_id =
        req.body.entry[0].changes[0].value.metadata.phone_number_id;
      let from = req.body.entry[0].changes[0].value.messages[0].from; // extract the phone number from the webhook payload
      let msg_body = req.body.entry[0].changes[0].value.messages[0].text.body; // extract the message text from the webhook payload
      let name = req.body.entry[0].changes[0].value.contacts[0].profile.name;

      // Store conversation history
      let conversationHistory;
      // ID of channel you watch to fetch the history for
      let channelId = "C03N0606Z24";

      try {
        // Call the conversations.history method using WebClient
        const result = await client.conversations.history({
          channel: channelId,
          include_all_metadata: true,
        });

        conversationHistory = result.messages;

        for (let i = 0; i < conversationHistory.length; i++) {
          if (
            conversationHistory[i].metadata.event_payload.phone_number === from
          ) {
            let parent_thread_ts = conversationHistory[i].ts;

            // Call the chat.postMessage method using the built-in WebClient
            const result = await client.chat.postMessage({
              // The token you used to initialize your app
              token: process.env.SLACK_TOKEN,
              channel: "C03N0606Z24",
              thread_ts: parent_thread_ts,
              text: msg_body,
              // You could also use a blocks[] array to send richer content
            });

            break;
          } else {
            await client.chat
              .postMessage({
                // The token you used to initialize your app
                token: process.env.SLACK_TOKEN,
                channel: "C03N0606Z24",
                text: `Incomming New Request: Name: *${name}*, Phone Number: *${from}* , Message: ${msg_body}`,
                metadata: {
                  event_type: "new_request",
                  event_payload: {
                    phone_number: from,
                  },
                },
              })
              .then((result) => console.log(result.metadata))
              .catch((err) => console.log(err));
          }
        }

      } catch (error) {
        console.error(error);
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.post("/slack/events", (req, res) => {
  res.status(200).send(req.query.challenge);
});

slackEvents.on("message", async (event) => {
  if (event.thread_ts && event.client_msg_id) {
    const replyMessage = event.text;
    const parent_thread_id = event.thread_ts;
    let client_phone_number;
    // console.log(replyMessage, parent_thread_id);

    const result = await client.conversations.history({
      token: process.env.SLACK_TOKEN,
      channel: "C03N0606Z24",
      latest: parent_thread_id,
      include_all_metadata: true,
      inclusive: true,
      limit: 1,
    });
    client_phone_number = await result.messages[0].metadata.event_payload
      .phone_number;
    // console.log(client_phone_number);

    axios({
      method: "POST",
      url:
        "https://graph.facebook.com/v12.0/101273609311306/messages?access_token=" +
        token,
      data: {
        messaging_product: "whatsapp",
        to: client_phone_number,
        text: { body: replyMessage },
      },
      headers: { "Content-Type": "application/json" },
    });
  }
});

app.get("/webhook", (req, res) => {
  const verify_token = process.env.VERIFY_TOKEN;

  // Parse params from the webhook verification request
  let mode = req.query["hub.mode"];
  let token = req.query["hub.verify_token"];
  let challenge = req.query["hub.challenge"];

  // Check if a token and mode were sent
  if (mode && token) {
    if (mode === "subscribe" && token === verify_token) {
      console.log("WEBHOOK_VERIFIED");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});
