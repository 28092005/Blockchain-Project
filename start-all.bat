@echo off
echo Starting Hardhat node...
start "Hardhat Node" cmd /k "npx hardhat node"
timeout /t 5

echo Deploying contracts...
call npx hardhat run scripts/deploy.js --network localhost

echo Copying addresses...
copy /y "deployed-addresses.json" "frontend\src\deployed-addresses.json"
copy /y "deployed-addresses.json" "backend\deployed-addresses.json"

echo Starting Backend...
start "CertChain Backend" cmd /k "cd backend && npm install && node server.js"

echo Starting Frontend...
start "CertChain Frontend" cmd /k "cd frontend && npm install && npm start"

echo All services started! Check the separate terminal windows.
echo Frontend should open automatically in your browser at http://localhost:3000
