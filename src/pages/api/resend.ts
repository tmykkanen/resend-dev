// Enable on-demand rendering: https://docs.astro.build/en/guides/on-demand-rendering/#enabling-on-demand-rendering
export const prerender = false;

import type { APIRoute } from "astro";
import { Resend } from "resend";

const resend = new Resend(import.meta.env.RESEND_API_KEY);

// Get constants from .env file. Must set .env variables on deployment servers as well.
const RESEND_SEGMENT_KEY = import.meta.env.RESEND_SEGMENT_KEY;
const RESEND_FROM = import.meta.env.RESEND_FROM;
const RESEND_TOPICS = JSON.parse(import.meta.env.RESEND_TOPICS);
const RESEND_WEBHOOK_SECRET = import.meta.env.DEV
  ? import.meta.env.RESEND_WEBHOOK_SECRET_DEV
  : import.meta.env.RESEND_WEBHOOK_SECRET_PROD;

// sleep function to space out calls to resend api
const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = await request.text();

    // BUG: Fix hacky solutions
    const event = resend.webhooks.verify({
      payload,
      headers: {
        id: request.headers.get("svix-id"),
        timestamp: request.headers.get("svix-timestamp"),
        signature: request.headers.get("svix-signature"),
      },
      webhookSecret: RESEND_WEBHOOK_SECRET,
    });

    console.log(event);

    if (event.type !== "email.received")
      return new Response("This endpoint is for email.received only.", {
        status: 400,
      });

    // Get email data
    const { data: email, error: emailError } =
      await resend.emails.receiving.get(event.data.email_id);

    if (emailError) throw new Error(emailError.message);

    // Resend limits requests to 2 per second
    await sleep(1000);

    // Get sender segments
    const { data: segments, error: segmentsError } =
      await resend.contacts.segments.list({
        email: email.from,
      });

    if (segmentsError) throw new Error(segmentsError.message);

    // Use regex to check if sender is in Authorized Senders segment
    const segmentsString = JSON.stringify(segments);
    if (!/Authorized Senders/.test(segmentsString)) {
      return new Response(null, {
        status: 422,
        statusText: "You are not part of the Authorized Senders segment!",
      });
    }

    // Get topic ID from target email
    console.log(email.to);
    const topicId = RESEND_TOPICS[email.to[0].split("@")[0]];
    if (!topicId) throw new Error("Invalid topic");

    // Create broadcast email
    const { data: broadcast, error: broadcastError } =
      await resend.broadcasts.create({
        segmentId: RESEND_SEGMENT_KEY,
        topicId,
        from: RESEND_FROM,
        subject: email.subject,
        html: `${email?.html} <hr> <p>Want to stop receiving these emails? <a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Click here to unsubscribe from this list.</a></p> `,
        replyTo: email?.from,
        name: `${email.subject} (${email?.from})`,
      });

    if (broadcastError) throw new Error(broadcastError.message);

    // Resend limits requests to 2 per second
    await sleep(1000);

    // Send broadcast email
    const { error } = await resend.broadcasts.send(broadcast.id);

    if (error) throw new Error(error.message);
    return new Response("Success!", { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response("Failure!", { status: 400 });
  }
};
