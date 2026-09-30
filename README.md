# Trip Vault

Your trips in one place: tickets, boarding passes and hotel bookings (read for you), a day-by-day itinerary
planned to your rules, the news and safety situation at the destination, and live flight status. It works in
the phone's browser as well as on the laptop, and can be installed to the home screen.

**Live:** https://anilgupta2606.github.io/tripManangement/ (also on the Money Home start page)

**Publish a change:** commit here, then `./deploy.sh`. It runs the tests, copies the app into the Money Home
site (`Anilgupta2606.github.io/tripManangement/`, which GitHub Pages already serves) and pushes it.

## Tabs

| Tab | What it does |
|---|---|
| **Trips** | Every trip, with a timeline built from its documents: flights, check-in/out, trains. Unfiled documents become a trip in one tap. |
| **Documents** | Upload PDFs or photos (or take a photo on the phone). The reader fills in **whose document** and **what type** it is, the PNR, flights, hotel dates and so on; you check it and save. Tap any document to view it full screen (PDFs are drawn on the page, so they open on phones too). *Scan mode* shows a boarding pass on a plain white background for the gate scanner. |
| **Itinerary** | Pick the city (its dates, hotel, arrival and departure flights come from your documents). **Plan with AI** plans every day; **Lay out the days** puts in only the fixed parts without AI. Edit, move, delete or add any item; **lock** what must stay. Type what you don't like in the box and the AI changes the plan. |
| **News** | The destination's news, war / unrest / security news, flight and airport disruption, the UK Foreign Office's travel advice and the weather, with an **AI summary**: all clear / be aware / serious. |
| **Flights** | Every flight from your tickets (or added by number): operating or not, on time, delayed, cancelled, gate and terminal. Flights in the next 36 hours are re-checked every 10 minutes while the tab is open. |
| **Memories** | Notes and photos per day of the trip. |

## Reading documents: built-in reader or AI reader

Settings → AI assistants → *Document reader*:

- **Built-in first, then AI fills the gaps** (default). The built-in reader runs on the device: PDF text,
  OCR for scans and photos (Tesseract), and the **boarding-pass barcode** (the IATA code on every pass, read
  exactly). The AI then reads the text to fill in or correct what it missed. It is skipped when the barcode was read.
- **AI first**: the AI reads the document; the built-in reader is used when no AI is available.
- **Built-in only**: nothing leaves the device.

Password-protected PDFs ask for the password. Photos are shrunk to a sensible size before they are kept.

## Itinerary rules

Itinerary → **Rules**. Every plan follows them, whether the AI wrote it, the built-in layout made it or you edited
it by hand. The AI is given the rules, and a checker marks the plan wherever it still breaks one
(*Fix these with AI* sends the problems back).

1. The day runs from a start time to a back-at-the-hotel time.
2. Pace (relaxed / balanced / packed) caps the number of sights a day.
3. No overlaps. There is a minimum gap between stops, and the stops are grouped by area so the day is a loop from the hotel.
4. Lunch and dinner go inside their time windows on full days.
5. Arrival day: nothing until landing + bags + transfer, and check-in time is respected.
6. Departure day: check-out time. Be at the airport 2 h before a domestic flight or 3 h before an international one, after the transfer.
7. Opening hours and weekly closing days are respected.
8. Rainy or very hot days get indoor plans; the forecast comes from Open-Meteo.
9. No place twice; the must-sees go early in the trip.
10. Areas under travel warnings are skipped.
11. Your budget, food, interests, travellers and things to avoid are respected.
12. **Locked** items are never changed.

## AI, keys and where data lives

- **AI** uses the same free services as the Expense Tracker and the Ledger (Gemini, Groq, Cerebras, Mistral,
  OpenRouter, local Ollama, or Claude with your own key). Keys added in the Expense Tracker or the Ledger in the
  same browser are used automatically. A **Google Gemini** key is the most useful: it reads photos and scans, and
  can search the web for news and flight status.
- **Flight status** comes from AeroDataBox (free on RapidAPI) or AirLabs (free) if you add a key. Otherwise
  Gemini searches the web. Each flight also links to FlightAware and Flightradar24.
- **News** comes from GDELT (worldwide news), gov.uk (travel advice) and Open-Meteo (weather). None of them needs a key.
- **Sign-in** is the Expense Tracker's username and password (else the Ledger's). A browser with neither starts
  with admin / admin; change it in Settings.
- **Your data** stays in this browser. **Settings → Phone ↔ laptop sync** encrypts it on the device (AES-GCM,
  key from your passphrase) and keeps it in private GitHub Gists: one for the trips data and one per document
  file. With the same token and passphrase on the phone you see the same vault, documents included. GitHub
  only ever holds unreadable data. Documents you have opened stay available offline.

Nothing personal is in this repository.

## Files

No build step. `index.html`, `style.css`, and:

| File | |
|---|---|
| `parse.js` | built-in reader: boarding-pass barcode (BCBP), dates, flights, PNR, hotel, train fields |
| `rules.js` | itinerary rules, the checker, the built-in layout |
| `cloud.js` | sign-in, AI services, encrypted Gist sync |
| `services.js` | PDF/OCR/barcode reading, AI reader, weather, news, flight status |
| `core.js` | saved data, shell, settings, sync |
| `docs.js` | Trips, Documents, viewer, Memories |
| `plan.js` | Itinerary |
| `live.js` | News, Flights |
| `sw.js` | offline copy of the app |
| `data/` | airports (OurAirports) and airlines |

Tests: `node --test test/*.test.js`
