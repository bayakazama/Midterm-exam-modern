How to Run the Scripts

This repository contains two Node.js scripts:

analyse_kommuner.js → Runs Lighthouse on every municipality website and creates one Excel file per municipality.

compare_kommuner.js → Reads all municipality Excel files and creates ONE combined comparison Excel file.

INSTALL DEPENDENCIES:
npm install

or

npm install lighthouse @tgwf/co2
npm install xlsx node-fetch chrome-launcher

This installs:

lighthouse

chrome-launcher

node-fetch

xlsx

@tgwf/co2

Google Chrome must also be installed on the machine.

1. Navigate to the scripts folder:
cd midtveiseksamen-modern/midtveiseksamen/scripts

2. Run the main analysis script
node analyse_kommuner.js

3. Wait until it finishes.

4. Run the comparison script:
node compare_kommuner.js

This will generate one combined Excel file:

../data/kommune/processed/ALL-KOMMUNER-COMPARISON.xlsx

Done
All final data is located in:
midtveiseksamen-modern/midtveiseksamen/data/kommune/processed/
