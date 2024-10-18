
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

const PORT = process.env.PORT || 3000;


app.use(express.json());
app.use(cors());
app.use(helmet());


app.use(cors({
  origin: '*', 
  credentials: true }));

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


REDIRECT_URI="https://cal-ydr3.onrender.com/oauth2callback"

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
    prompt: 'consent'
  });
  res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  console.log('Received authorization code:', code);

  try {
    // Exchange code for access token
    const { tokens } = await oauth2Client.getToken(code);
    console.log('Tokens received from Google:', tokens); 

    oauth2Client.setCredentials(tokens);
    console.log('Credentials set for oauth2Client.');
    const oauth2ClientWithToken = google.oauth2({
      auth: oauth2Client,
      version: 'v2'
    });

    const userInfoResponse = await oauth2ClientWithToken.userinfo.get();
    console.log('User info response:', userInfoResponse.data); // Debugging: log user info

    const email = userInfoResponse.data.email;
    console.log('Extracted email:', email); // Debugging: log extracted email

    tokenStorage.set(email, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date
    });

    console.log(`Tokens stored for ${email}:`, tokenStorage.get(email)); // Debugging: log stored tokens

    // Redirect to frontend after storing tokens
    console.log('Redirecting to frontend...');
    res.redirect('http://localhost:3000/dashboard/calender');
  } 
  catch (err) {
    console.error('Error retrieving access token or fetching user info:', err); // Debugging: log error
    res.send('Error during authentication');
  }
});


app.get('/api/get_tokens', (req, res) => {
  const email = req.query.email;  

  console.log(`Retrieving tokens for email: ${email}`);
  
  if (tokenStorage.has(email)) {
      res.json(tokenStorage.get(email));
  } else {
      res.status(401).send('No tokens available for this email');
  }
});

app.get('/api/debug/tokenStorage', (req, res) => {
  const tokenData = Array.from(tokenStorage.entries());
  
  console.log('Current state of tokenStorage:', JSON.stringify(tokenData, null, 2)); // Pretty-print JSON for easier reading

  res.json(tokenData);
});


app.post('/api/store-tokens', (req, res) => {
  const { email, access_token, refresh_token, expiry_date } = req.body;

  if (!email || !access_token || !refresh_token || !expiry_date) {
    return res.status(400).send('Missing required fields');
  }

  tokenStorage.set(email, { access_token, refresh_token, expiry_date });

  console.log(`Tokens stored for ${email}:`, tokenStorage.get(email));

  res.status(200).send('Tokens stored successfully');
});





app.delete('/delete-event/:eventId', async (req, res) => {
  const eventId = req.params.eventId;
  const { email } = req.body;  
  console.log(`Attempting to delete event with ID: ${eventId} for user: ${email}`);

  try {
    const tokens = tokenStorage.get(email);

    if (!tokens) {
      console.error(`No tokens found for user: ${email}`);
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

        console.log(`Token refreshed successfully for ${email}.`);
      } catch (refreshError) {
        console.error(`Error refreshing access token for ${email}:`, refreshError);
        return res.status(500).json({ success: false, message: 'Error refreshing access token.' });
      }
    }

    const calendar = google.calendar({ version: 'v3', auth: oauth2ClientForUser });
    
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId,
    });

    console.log(`Event with ID: ${eventId} deleted successfully for user: ${email}`);
    res.json({ success: true, message: 'Event deleted successfully.' });
  } catch (error) {
    console.error(`Error deleting event with ID: ${eventId} for user: ${email}`, error);

    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});


app.post('/create-event', async (req, res) => {
  const { email, title, startDate, endDate, location, description, attendees } = req.body;

  console.log('Received request to create event:', { email, title, startDate, endDate, location, attendees });

  try {
    const tokens = tokenStorage.get(email);

    if (!tokens) {
      console.error(`No tokens found for user: ${email}`);
      return res.status(401).json({ success: false, message: 'No tokens found for this user.' });
    }

    console.log(`Tokens found for ${email}:`, tokens);

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
      console.log(`Token for ${email} has expired, attempting to refresh...`);

      try {
        const newTokens = await oauth2ClientForUser.refreshAccessToken();
        const updatedTokens = newTokens.credentials;

        tokenStorage.set(email, {
          access_token: updatedTokens.access_token,
          refresh_token: updatedTokens.refresh_token || tokens.refresh_token,
          expiry_date: updatedTokens.expiry_date,
          token_type: updatedTokens.token_type
        });

        console.log(`Token refreshed successfully for ${email}:`, updatedTokens);
      } catch (refreshError) {
        console.error(`Error refreshing access token for ${email}:`, refreshError);
        return res.status(500).json({ success: false, message: 'Error refreshing access token.' });
      }
    }

    // Filter out the organizer (email) from the attendees list
    const attendeesFiltered = attendees.filter(att => att !== email).map(att => ({ email: att.trim() }));

    console.log(`Filtered attendees (without organizer):`, attendeesFiltered);

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

    console.log(`Creating event for ${email} with details:`, event);

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1,
      sendUpdates: 'all', 
    });

    console.log(`Event created successfully for ${email}:`, response.data);
    res.json({ success: true, event: response.data });
  } catch (error) {
    console.error(`Error creating event for ${email}:`, error);
    res.json({ success: false, error: error.message });
  }
});


// app.get('/list-events', async (req, res) => {
//   try {
//     const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

//     // List events from the user's primary calendar
//     const response = await calendar.events.list({
//       calendarId: 'primary',   // For the primary calendar
//       timeMin: new Date().toISOString(), // Fetch events starting from now
//       maxResults: 10,          // Adjust based on how many events you want
//       singleEvents: true,      // Only return single events (not recurring events)
//       orderBy: 'startTime',    // Order events by start time
//     });

//     // Send events as JSON response
//     res.json({ success: true, events: response.data.items });
//   } catch (error) {
//     console.error('Error fetching events:', error);
//     res.json({ success: false, error: error.message });
//   }
// });

// app.get('/list-events', async (req, res) => {
//   try {
//     const { start, end } = req.query;  // Get start and end dates from query params

//     if (!start || !end) {
//       return res.status(400).json({ success: false, message: 'Please provide both start and end dates.' });
//     }

//     const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

//     // Fetch events between the provided start and end dates
//     const response = await calendar.events.list({
//       calendarId: 'primary',
//       timeMin: new Date(start).toISOString(),  // Start of the range
//       timeMax: new Date(end).toISOString(),    // End of the range
//       singleEvents: true,                      // Only return single events (not recurring)
//       orderBy: 'startTime',                    // Order events by start time
//     });

//     // Send the fetched events as JSON response
//     res.json({ success: true, events: response.data.items });
//   } catch (error) {
//     console.error('Error fetching events:', error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

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
    console.error('Error fetching events:', error);
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
    console.error('Error fetching event:', error);
    res.json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});