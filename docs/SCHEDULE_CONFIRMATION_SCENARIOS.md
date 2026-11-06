# Schedule confirmation: real conversation scenarios

Review date: 2026-11-06. Source: read-only queries on production (`lead_hold_alerts`
history joined to saved Quo texts and speaker-attributed call transcripts).

Sample: every urgent lead that moved from **Waiting for CX for schedule
confirmation** to **Ready to schedule** between 2026-10-12 and 2026-11-05:
112 leads, 109 with a saved chat. 108 of the moves were made by people; 4 were
made by the AI worker. For each lead we read the chat from shortly before the
waiting tag up to the move. Only urgent jobs create `lead_hold_alerts`, so
non-urgent jobs are not in the sample. Counts below are approximate (one reviewer
reading, one lead can fit two scenarios).

Customer quotes below are short and anonymized; no names, numbers or addresses.

## How our team proposes the schedule

Almost always a text in this shape, often followed by a call with the same words:

> "Me or my guy will be there on Tuesday 3 Nov between 9-11am and will call you
> from personal number before arriving" + "I need your confirmation."

Variants: "Can we schedule for tomorrow between 10-12?", "Please let me know if
you're available on 27 Oct between 4-6 PM", two slots to choose from, Spanish.

## Scenarios that people treated as confirmed

| # | Scenario | ~Leads | Examples | AI rule |
|---|----------|--------|----------|---------|
| A | Short yes to our schedule text | 40 | "Ok", "Okay 👍", "Yes", "Confirmed ☑️", "I confirm", "Sounds good", "Time is ok.", "Yes sir", "You got it. (Confirmed)" | Confirm |
| B | Agreed on a call right after our team states the time | 25 | "Alright. That's fine. That works.", "Okay. Confirm.", "Yes. Yes. Yes.", "Oké", "Inshallah. Yep.", "I'll be there at six." | Confirm (customer's own call lines) |
| C | Customer asked for another time, **our team sent a new schedule**, customer accepted it | 14 | "Saturday morning would be better" → our new Saturday 9-11 → "Awesome thank you"; "Tomorrow morning I am not available" → our 3-5pm → "I confirm" | Confirm — our new message is the latest proposal |
| D | Customer pushed back, then went back to **our** earlier offer | 4 | "Is there availability Friday?" → "No problem. Thursday, Nov 5 works."; "Oh okay Tomorrow then" | Confirm — not a change |
| E | Acceptance plus logistics, payment or identity question | 12 | "That is fine. How do you want payment?", "Yes, we are available. What is his name?", "Please have him text me", "My daughter will be there", "Perfect thank you" | Confirm |
| F | Acceptance with a preference **inside** our window | 6 | "I should be free by 11" (10-12), "You can come at 4 PM" (4-6), "before 4:30 is fine" (3-5), "Earlier would be better" | Confirm — not a change |
| G | Other language | 2 | "Si está bien", "Si .ok" | Confirm |

## Scenarios that must NOT move the tag

| # | Scenario | Examples | What happened |
|---|----------|----------|---------------|
| H | Customer names their own day/date/time | "How about the 14th?", "09:30 and 10:30 on Saturday.", "Can he come Tuesday", "Is Tuesday an option?" | The old AI moved two of these. Now kept waiting. |
| I | Vague / later | "I do. In about 1 week", "I will confirm tomorrow", "I'll let you know by the end of the day" | The old AI moved "In about 1 week". Now kept waiting. |
| J | Customer counter-offers and our team only says "yes we can" | "We can do starting at 9. Does that work?" → "Yes we can start 9am" (no customer reply after) | A person moved it. The AI now leaves it for a person, who must update the schedule. |
| K | Hold / cancel / away | "Let's hold for the moment", "I'm out of town for a week, let me text you when I get back" | A person moved one of these to Ready — likely a mistake worth checking. |
| L | Only a question | "What is the name of your company?", "So not on Wednesday?" | Not a confirmation. |
| M | "Ok" to a different question (payment, address) | "Do you take cc?" → "cash, zelle or venmo" → "Okay, sure" | Not a schedule confirmation. |

## Moves with no customer acceptance in the chat

About 12 leads were moved by a person with no customer acceptance in the saved
chat (agreement probably on an unrecorded call, voicemail, or the move was early).
The AI will correctly leave such jobs for a person.

## Rules now enforced (worker `schedule-confirmation.ts`)

1. The AI must cite our team's latest schedule message or call line.
2. The cited customer words must come after it, after the waiting tag, and must not
   be only a question.
3. If the customer named or asked for their own/different day or time after our
   latest schedule, the job stays waiting for a person.
4. Repeating our time, picking one of our options, going back to our earlier offer,
   or a preference inside our window is not a change.
5. Texts and call transcripts follow the same rules; our team's words and call
   summaries are never proof.
