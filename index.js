
const fs = require('fs');
const express = require('express');
const { google } = require('googleapis');
const dotenv = require('dotenv');
const cors = require('cors');
const session = require('express-session');
const axios = require('axios');
const oauth2 = google.oauth2('v2');
const helmet = require('helmet');

dotenv.config();
const app = express();

const PORT = process.env.PORT || 3001;


app.use(express.json());
app.use(helmet());


const allowedOrigins = ['http://localhost:3001', 'https://www.candidate.live',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(session({
  secret: 'chetansingh24',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));


const REDIRECT_URI="https://cal-ydr3.onrender.com/oauth2callback"

// const REDIRECT_URI="http://http://localhost:8080/oauth2callback"

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.SECRET_ID;
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const tokenStorage = new Map();

app.get('/', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/userinfo.email'
    ],
    // prompt: 'consent'
  });
  res.redirect(authUrl);
});



app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;

  try {
    const { tokens } = await oauth2Client.getToken(code);


    oauth2Client.setCredentials(tokens);
    const oauth2ClientWithToken = google.oauth2({
      auth: oauth2Client,
      version: 'v2'
    });

    const userInfoResponse = await oauth2ClientWithToken.userinfo.get();
    const email = userInfoResponse.data.email;



    tokenStorage.set(email, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date
    });

    res.redirect('https://www.candidate.live/dashboard/calender');
    // res.redirect('http://localhost:3000/dashboard/calender');

  }

  catch (err) {
    console.error('Error retrieving access token or fetching user info:', err);
    res.send('Error during authentication');
  }
});




// app.get('/api/get_tokens', (req, res) => {
//   const email = req.query.email;
//   if (tokenStorage.has(email)) {
//     return res.json(tokenStorage.get(email));
//   }
//   const authUrl = oauth2Client.generateAuthUrl({
//     access_type: 'offline',
//     scope: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/userinfo.email'],
//     prompt: 'consent',
//   });
//   res.redirect(authUrl);
// });


app.get('/api/get_tokens', (req, res) => {
  const email = req.query.email;

  if (!email) {
    return res.status(400).json({
      error: 'Email required',
      needsAuth: true
    });
  }

  if (tokenStorage.has(email)) {
    return res.json(tokenStorage.get(email));
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/userinfo.email'],
    // prompt: 'consent',
  });

  return res.json({
    needsAuth: true,
    authUrl: authUrl
  });
});


app.get('/api/debug/tokenStorage', (req, res) => {
  const tokenData = Array.from(tokenStorage.entries());
  res.json(tokenData);
});


app.post('/api/store-tokens', (req, res) => {
  const { email, access_token, refresh_token, expiry_date } = req.body;

  if (!email || !access_token || !refresh_token || !expiry_date) {
    return res.status(400).send('Missing required fields');
  }

  tokenStorage.set(email, { access_token, refresh_token, expiry_date });


  res.status(200).send('Tokens stored successfully');
});





app.delete('/delete-event/:eventId', async (req, res) => {
  const eventId = req.params.eventId;
  const { email } = req.body;

  try {
    const tokens = tokenStorage.get(email);

    if (!tokens) {
      return res.status(401).json({ success: false, message: 'No tokens found for this user.' });
    }

    const oauth2ClientForUser = new google.auth.OAuth2(
      process.env.CLIENT_ID,
      process.env.SECRET_ID,
      REDIRECT_URI
    );
    oauth2ClientForUser.setCredentials(tokens);

    if (Date.now() >= tokens.expiry_date) {
      console.log(`Token for ${email} has expired, attempting to refresh...`);

      try {
        const newTokens = await oauth2ClientForUser.refreshAccessToken();
        const updatedTokens = newTokens.credentials;

        tokenStorage.set(email, {
          access_token: updatedTokens.access_token,
          refresh_token: updatedTokens.refresh_token || tokens.refresh_token, // Keep old refresh token if new one isn't provided
          expiry_date: updatedTokens.expiry_date,
          token_type: updatedTokens.token_type
        });

      } catch (refreshError) {
        return res.status(500).json({ success: false, message: 'Error refreshing access token.' });
      }
    }

    const calendar = google.calendar({ version: 'v3', auth: oauth2ClientForUser });

    await calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId,
    });

    res.json({ success: true, message: 'Event deleted successfully.' });
  } catch (error) {

    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});









app.post('/create-event', async (req, res) => {
  const { email, title, startDate, endDate, location, description, attendees } = req.body;


  try {
    const tokens = tokenStorage.get(email);

    if (!tokens) {
      return res.status(401).json({ success: false, message: 'No tokens found for this user.' });
    }


    const oauth2ClientForUser = new google.auth.OAuth2(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET,
      REDIRECT_URI
    );
    oauth2ClientForUser.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    });

    if (Date.now() >= tokens.expiry_date) {

      try {
        const newTokens = await oauth2ClientForUser.refreshAccessToken();
        const updatedTokens = newTokens.credentials;

        tokenStorage.set(email, {
          access_token: updatedTokens.access_token,
          refresh_token: updatedTokens.refresh_token || tokens.refresh_token,
          expiry_date: updatedTokens.expiry_date,
          token_type: updatedTokens.token_type
        });

      } catch (refreshError) {
        return res.status(500).json({ success: false, message: 'Error refreshing access token.' });
      }
    }

    // Filter out the organizer (email) from the attendees list
    const attendeesFiltered = attendees.filter(att => att !== email).map(att => ({ email: att.trim() }));


    const calendar = google.calendar({ version: 'v3', auth: oauth2ClientForUser });
    const event = {
      summary: title,
      location: location,
      description: description,
      start: {
        dateTime: startDate,
        timeZone: 'Asia/Kolkata',
      },
      end: {
        dateTime: endDate,
        timeZone: 'Asia/Kolkata',
      },
      attendees: attendeesFiltered,
      conferenceData: {
        createRequest: {
          requestId: 'random-id',
          conferenceSolutionKey: {
            type: 'hangoutsMeet',
          },
        },
      },
    };


    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1,
      sendUpdates: 'all',
    });

    res.json({ success: true, event: response.data });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});



app.get('/list-events', async (req, res) => {
  try {
    const { email, start, end } = req.query;

    if (!email || !start || !end) {
      return res.status(400).json({ success: false, message: 'Please provide email, start, and end dates.' });
    }
    const tokens = tokenStorage.get(email);

    if (!tokens) {
      return res.status(401).json({ success: false, message: 'No tokens found for this user' });
    }

    const oauth2ClientForUser = new google.auth.OAuth2(
      process.env.CLIENT_ID,
      process.env.SECRET_ID,
      REDIRECT_URI
    );
    oauth2ClientForUser.setCredentials(tokens); // Set the user's tokens

    const calendar = google.calendar({ version: 'v3', auth: oauth2ClientForUser });

    // Fetch events between the provided start and end dates
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    // Send the fetched events as JSON response (keeping the response structure unchanged)
    res.json({ success: true, events: response.data.items });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


app.get('/get-event/:eventId', async (req, res) => {
  const eventId = req.params.eventId;

  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Fetch the event by eventId
    const response = await calendar.events.get({
      calendarId: 'primary',
      eventId: eventId,
    });

    res.json({ success: true, event: response.data });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});



app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
