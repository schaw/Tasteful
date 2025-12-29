# Firebase Setup Instructions

## Step 1: Create Firebase Project
1. Go to https://console.firebase.google.com/
2. Click "Create a project"
3. Enter project name: "tasteful-movie-app" (or your preferred name)
4. Disable Google Analytics (optional for this project)
5. Click "Create project"

## Step 2: Enable Authentication
1. In your Firebase console, click "Authentication" in the left sidebar
2. Click "Get started"
3. Go to "Sign-in method" tab
4. Enable "Email/Password" provider
5. Click "Save"

## Step 3: Enable Firestore Database
1. Click "Firestore Database" in the left sidebar
2. Click "Create database"
3. Choose "Start in test mode" (we'll secure it later)
4. Select your preferred location
5. Click "Done"

## Step 4: Get Firebase Configuration
1. Click the gear icon (⚙️) next to "Project Overview"
2. Select "Project settings"
3. Scroll down to "Your apps" section
4. Click the web icon (</>) to add a web app
5. Enter app nickname: "tasteful-web-app"
6. Don't check "Firebase Hosting" (we're using GitHub Pages)
7. Click "Register app"
8. Copy the firebaseConfig object

## Step 5: Update Firebase Configuration
1. Open `src/firebase.js` in your project
2. Replace the placeholder config with your actual config:

```javascript
const firebaseConfig = {
  apiKey: "your-actual-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-actual-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "your-actual-app-id"
};
```

## Step 6: Test Locally
1. Run `npm start`
2. You should see a login screen
3. Create an account with email/password
4. Your movie data should sync to Firebase

## Step 7: Deploy to GitHub Pages
1. Commit and push your changes:
```bash
git add .
git commit -m "Add Firebase authentication"
git push origin main
npm run deploy
```

## Security Rules (Optional - for production)
Once everything works, you can secure your Firestore database:

1. Go to Firestore Database → Rules
2. Replace the rules with:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

This ensures users can only access their own data.

## Troubleshooting
- If you get CORS errors, make sure your domain is added to Firebase Auth settings
- For GitHub Pages, add `https://yourusername.github.io` to authorized domains
- Check browser console for detailed error messages
