# CertChain Hosting Guide

## Prerequisites
- MetaMask wallet with a real private key
- ~0.5 Sepolia ETH (free from faucet)
- GitHub account
- Render.com account (free)
- Vercel account (free)

---

## Step 1 — Get Sepolia Test ETH
1. Open MetaMask → copy your wallet address
2. Go to https://sepoliafaucet.com and request ETH
3. Export your private key: MetaMask → Account Details → Export Private Key

## Step 2 — Deploy Contracts to Sepolia
Update root `.env`:
```
PRIVATE_KEY=0x<your_metamask_private_key>
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/586fcdb1ab69434396aea0949c24229c
```

Run:
```bash
npx hardhat run scripts/deploy.js --network sepolia
```

This writes new contract addresses to:
- `deployed-addresses.json`
- `backend/deployed-addresses.json`
- `frontend/src/deployed-addresses.json`

Note the `CertificateRegistry` address from the output.

## Step 3 — Push to GitHub
```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/<you>/certchain.git
git push -u origin main
```

## Step 4 — Deploy Backend on Render.com
1. Go to https://render.com → New → Web Service
2. Connect your GitHub repo
3. Set:
   - Root Directory: `backend`
   - Build Command: `npm install`
   - Start Command: `node server.js`
4. Add Environment Variables:
   - `RPC_URL` = `https://sepolia.infura.io/v3/586fcdb1ab69434396aea0949c24229c`
   - `DEPLOYER_PRIVATE_KEY` = `0x<your_metamask_private_key>`
   - `FRONTEND_URL` = (leave blank for now, fill in after Step 5)
   - `PORT` = `4000`
5. Deploy — note your Render URL e.g. `https://certchain-backend.onrender.com`

## Step 5 — Deploy Frontend on Vercel
1. Go to https://vercel.com → New Project → Import your GitHub repo
2. Set:
   - Root Directory: `frontend`
   - Framework: Create React App
3. Add Environment Variable:
   - `REACT_APP_BACKEND_URL` = `https://certchain-backend.onrender.com`
4. Deploy — note your Vercel URL e.g. `https://certchain.vercel.app`

## Step 6 — Link Frontend URL to Backend
1. Go back to Render dashboard → certchain-backend → Environment
2. Set `FRONTEND_URL` = `https://certchain.vercel.app`
3. Redeploy the backend

---

## Done!
- Public verifier: `https://certchain.vercel.app` (no wallet needed)
- Institution panel: same URL → Institution Panel tab (uses backend wallet)
