// Enable on-demand rendering: https://docs.astro.build/en/guides/on-demand-rendering/#enabling-on-demand-rendering
export const prerender = false;

import type { APIRoute } from "astro";
import { Resend } from "resend";

const resend = new Resend(import.meta.env.RESEND_API_KEY);

// TODO: Clean up imports?
// Get constants from .env file. Must set .env variables on deployment servers as well.
const { RESEND_FROM } = import.meta.env;

// JSON.parse to handle string to object conversion
const RESEND_TOPICS = JSON.parse(import.meta.env.RESEND_TOPICS);
const RESEND_SEGMENTS = JSON.parse(import.meta.env.RESEND_SEGMENTS);

const RESEND_WEBHOOK_SECRET = import.meta.env.DEV
  ? import.meta.env.RESEND_WEBHOOK_SECRET_DEV
  : import.meta.env.RESEND_WEBHOOK_SECRET_PROD;

// Util pause function to space out calls to resend api
const pause = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const POST: APIRoute = async ({ request }) => {
  try {
    // Verify webhook: https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
    const payload = await request.text();

    const event = resend.webhooks.verify({
      payload,
      headers: {
        id: request.headers.get("svix-id") || "",
        timestamp: request.headers.get("svix-timestamp") || "",
        signature: request.headers.get("svix-signature") || "",
      },
      webhookSecret: RESEND_WEBHOOK_SECRET,
    });

    // FIX: Type unkown
    // Check if event is email.received and return if false
    if (event.type !== "email.received")
      return new Response("This endpoint is for `email.received` only.", {
        status: 200,
      });

    // FIX: Type unkown
    // Get email, including html body, since webhooks do not contain this data: https://resend.com/docs/dashboard/receiving/forward-emails
    const { data: email, error: emailError } =
      await resend.emails.receiving.get(event.data.email_id);
    if (emailError) throw new Error(emailError.message);

    // Resend limits requests to 2 per second
    await pause(1000);

    // Check that contact is authorized sender. Must have property authorized_sender set to 'true'
    const { data: contact, error: contactError } = await resend.contacts.get({
      email: email.from,
    });
    if (contactError) throw new Error(contactError.message);

    const authorized =
      contact.properties.authorized_sender &&
      contact.properties.authorized_sender.value === "true";
    if (!authorized)
      return new Response("Unauthorized sender!", { status: 200 });

    // TODO: Refactor
    // Get segment / topic from sender email
    // e.g. myTopic@example.com would set target to 'myTopic'
    const target = email.to[0].split("@")[0];

    const topicId = RESEND_TOPICS[target];
    console.log("topicId: ", topicId);
    const segmentId = topicId
      ? RESEND_SEGMENTS.default
      : RESEND_SEGMENTS[target];

    if (!topicId && !segmentId)
      return new Response("Invalid target!", { status: 200 });

    // Create broadcast email
    const { data: broadcast, error: createBroadcastError } =
      await resend.broadcasts.create({
        segmentId,
        topicId,
        from: RESEND_FROM,
        subject: email.subject,
        html: `${email?.html} <hr> <p>Want to stop receiving these emails? <a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Click here to unsubscribe from this list.</a></p> `,
        replyTo: email?.from,
        name: `${email.subject} (${email?.from})`,
      });
    if (createBroadcastError) throw new Error(createBroadcastError.message);

    // Resend limits requests to 2 per second
    await pause(1000);

    // Send broadcast email
    const { error: sendBroadcastError } = await resend.broadcasts.send(
      broadcast.id,
    );
    if (sendBroadcastError) throw new Error(sendBroadcastError.message);

    // Return 200 if all was completed successfully
    return new Response("Success!", { status: 200 });
  } catch (error) {
    console.error(error);
    if (typeof error === "string") {
      return new Response(error, { status: 400 });
    }
    return new Response("Unknown Failure!", { status: 400 });
  }
};
