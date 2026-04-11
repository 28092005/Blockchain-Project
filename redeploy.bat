@echo off
echo Deploying contracts...
cd /d e:\certchain
call npx hardhat run scripts/deploy.js --network localhost
echo Copying addresses...
copy /y "e:\certchain\deployed-addresses.json" "e:\certchain\frontend\src\deployed-addresses.json"
copy /y "e:\certchain\deployed-addresses.json" "e:\certchain\backend\deployed-addresses.json"
echo Done! Now refresh your browser.
