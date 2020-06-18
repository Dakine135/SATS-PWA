const puppeteer = require('puppeteer');
const fs = require("fs");
const envInputRaw = fs.readFileSync("env.json");
const envInput = JSON.parse(envInputRaw);
var browser;

var express = require('express');
var app = express();

//data
var activitiesDataBase = {};
var mostRecentActivityId = 0;
// var ticketNotesCache = {};

app.get('/getActivity', async function (req, res) {
	try {
		console.log("Route getActivity called");
		await updateDataBase();
		res.send( activitiesDataBase );
	} catch(error) {
		console.log("Route getActivity error", error);
		res.error("some problem");
	}
	
 });

 var server = app.listen(8081, function () {
	var host = server.address().address;
	var port = server.address().port;
	console.log("SATS API app listening at http://%s:%s", host, port);
 });

/*
----Start----
{
  iconType: 'comment',
  text: ' Matthew Cleary added a note to Ticket #22275 at 11:42:30 AM',
  action: 'added',
  dateTime: '04/24/20 11:42:30 AM',
  parts: [
    {
      text: 'Matthew Cleary',
      link: 'https://support.sa.sc.edu/admin/users/32/edit',
      type: 'users'
    },
    {
      text: 'Ticket #22275',
      link: 'https://support.sa.sc.edu/admin/tickets/22275/edit',
      type: 'tickets',
      ticketNumber: '22275',
      note: [Object]
    }
  ]
}
{
  text: "Found a Logitech C270 at Amazon. Usually $40, not $140. I'm not buying at that price.",
  private: true,
  user: 'Matthew Cleary',
  dateTime: '04/24/20 11:42:30 AM'
}
----END----
*/
 
async function updateDataBase(){
	console.log("Start browser");
	browser = await puppeteer.launch({headless: true}); //{headless: false, slowMo: 250}
	let closeBrowser = true;
	
	await connectAndLogin();

	let allActivity = await getActivites();

	let notesToGet = {};

	//pre-processing
	console.log(`pre-processing ${allActivity.length} activity items`);
	let alreadyProcessedCount = 0;
 	allActivity.forEach(async(item)=>{
		// console.log("----Start----");
		if(mostRecentActivityId < item.id) mostRecentActivityId = item.id;
		if(activitiesDataBase[item.id] == null){
			if(item.action == undefined || item.action == null || item.ticketNumber == "N/A"){
				console.log("Item Text:", item.text);
				console.log("Item Action:", item.action);
			}
			//console.log(item.ticketNumber);
			
			switch(item.action){
				case 'added a note to Ticket':
					//If action is a Note addition, add to que to later lookup ticket and get note.
					//this is to avoid looking up the same ticket multiple times.

					if(notesToGet[item.ticketNumber] == null) notesToGet[item.ticketNumber] = {};
					notesToGet[item.ticketNumber][item.dateTimeString] = item.id;
		
					activitiesDataBase[item.id] = item;
					break;
				case 'was added as a technician':
				case 'closed Ticket':
				case 'submitted Ticket':
				case 'suspended Ticket':
				case 'activated Ticket':
				case 'closed Ticket':
					//these do not need additional Processing
					activitiesDataBase[item.id] = item;
					break;
				default:
					console.log('action type unknown', item.action);
			}
			
		} else {
			//console.log("Already Processesed this activity item", item.id);
			alreadyProcessedCount++;
		}
		 //TODO handle other types like submitted or assigned or closed
		// console.log("----END----");
	}); //each activity item
	console.log(`${alreadyProcessedCount} already processed`);
	
	//post-processing
	let ticketsToGet = Object.keys(notesToGet);
	console.log(`Getting Notes for ${ticketsToGet.length} Tickets`);
	await Promise.all(ticketsToGet.map(async (ticketNumber) => {
		try {
			let allNotesFromTicket = await getNotesFromTicket(ticketNumber);
			// console.log(allNotesFromTicket);
			let noteUpdateItem = notesToGet[ticketNumber];
			allNotesFromTicket.forEach((note)=>{
				if(noteUpdateItem.hasOwnProperty(note.dateTimeString)){
					let activityId = noteUpdateItem[note.dateTimeString];
					activitiesDataBase[activityId]['note'] = note;
				}
			});
		} catch(error) {
			console.log("error getting notes from ticket", ticketNumber, error);
		}
	}));
 	
 	console.log("finished script");
 	
	if(closeBrowser) await browser.close();
};

async function connectAndLogin(){
	let page = await browser.newPage();
	// await page.setViewport({width: 1920, height: 1080});
	await page.goto('https://support.sa.sc.edu');
	// await page.screenshot({path: 'example.png'});
	console.log("Navigate to Support SATS");

  	// Login
	await page.type('#user_session_login', envInput.login);
	await page.type('#user_session_password', envInput.pass);
	await page.click('input[value="Login"]');
	page.close();
	console.log("Logged in");
	// await page.waitForNavigation();
}

async function getActivites(){
	let page = await browser.newPage();
	//go to activities page and get list
	await page.goto('https://support.sa.sc.edu/activities');
	// await page.waitForNavigation();
	console.log("Go to activities page");
	return await page.evaluate(() => {
        let activities = [];
        //get all direct children of element with class "container main"
        let everythingInMain = document.querySelectorAll('.container.main > *');
        // console.log(everythingInMain);
        let date = "N/A";
        everythingInMain.forEach((item)=>{
        	// console.log(item.tagName);
        	if(item.tagName == 'H3'){
        		console.log("H3 tag:",item.innerText);
        		date = item.innerText;
        	} else if(item.classList.contains('activity')){
        		let activityJson = {};
	            console.log(item);
	            try {
	            	let iconName = item.querySelector('i').className;
					let iconType = iconName.split(' ')[1].split('-')[1];
					let activityId = item.id.split('_')[1];
					// console.log('iconType: ', iconType);
					activityJson.id = activityId;
					activityJson.ticketNumber = "N/A";
	            	activityJson.iconType = iconType;
	            	activityJson.text = item.innerText;
					let actionTest = activityJson.text.split(' ')[3];
					switch (actionTest) {
						case "added":
							actionTest = activityJson.text.split(" ").splice(3,5).join(" ");
							//activityJson.text.split(' ').splice(3,7).join(" ");
							
							if(actionTest != "added a note to Ticket"){
								console.error("Error collision action type", activityJson.text);
							} else activityJson.action = actionTest;
							break;
						case "was":
							actionTest = activityJson.text.split(" ").splice(3,5).join(" ");
							if(actionTest != "was added as a technician"){
								console.error("Error collision action type", activityJson.text);
							} else activityJson.action = actionTest;
							break;
						case "submitted":
							actionTest = activityJson.text.split(' ').splice(3,2).join(" ");
							if(actionTest != "submitted Ticket"){
								console.error("Error collision action type", activityJson.text);
							} else activityJson.action = actionTest;
							break;
						case "closed":
							actionTest = activityJson.text.split(' ').splice(3,2).join(" ");
							if(actionTest != "closed Ticket"){
								console.error("Error collision action type", activityJson.text);
							} else activityJson.action = actionTest;
							break;
						case "activated":
							actionTest = activityJson.text.split(' ').splice(3,2).join(" ");
							if(actionTest != "activated Ticket"){
								console.error("Error collision action type", activityJson.text);
							} else activityJson.action = actionTest;
							break;
						case "suspended":
							actionTest = activityJson.text.split(' ').splice(3,2).join(" ");
							if(actionTest != "suspended Ticket"){
								console.error("Error collision action type", activityJson.text);
							} else activityJson.action = actionTest;
							break;
						case "uploaded":
							actionTest = activityJson.text.split(' ').splice(3,1).join(" ");
							//action text only one word
							activityJson.action = actionTest;
							break;
						default:
							console.log("unhandled action case", actionTest);
					} //switch block
					if (!activityJson.text.includes(' at ')){
						activityJson.dateTimeString = "N/A";
						activityJson.dateTimeMilliSeconds = "N/A";
					} else {
						activityJson.dateTimeString = date +' '+ activityJson.text.split(' at ')[1];
						activityJson.dateTimeMilliSeconds = new Date(activityJson.dateTimeString).getTime();
					}
	            	let partsElms = item.querySelectorAll('a');
	            	partsElms.forEach((part)=>{
						let partType = part.href.split('/')[4];
						switch(partType){
							case 'tickets':
								activityJson.ticketNumber = part.href.split('/')[5];
								break;
							case 'users':
								activityJson.userId = part.href.split('/')[5];
								activityJson.userFullName = part.innerText;
								break;
							default:
								console.log('unknown part type');
						}
	            	});
	            }
	            catch (exception){

				}
				//console.log(activityJson);
				if(activityJson.action != "uploaded"){
					activities.push(activityJson);
				}
        	}
        });
        return activities;
    });
}

//open page referenced, get ticket comments
async function getNotesFromTicket(ticketNumber){
	let ticketNotes;
	if(false){ //ticketNotesCache[ticketNumber] != null
		//ticketNotes = ticketNotesCache[ticketNumber];
		//TODO need to check for timestamp and if there have been new changes on that ticket.
	} else {
		// console.log("open new tab for ticket: ", ticketNumber);
		let tab = await browser.newPage();
		await tab.goto('https://support.sa.sc.edu/admin/tickets/'+ticketNumber+'/edit');
		ticketNotes = await tab.evaluate(() => {
			let notes = [];
			let notesDiv = document.querySelector('#notes');
			console.log(notesDiv);
			let eachNoteDiv = notesDiv.querySelectorAll('div .media-body');
			// console.log(eachNoteDivs);
			eachNoteDiv.forEach((noteDiv)=>{
				let tempNote = {};
				console.log(noteDiv);
				tempNote.text = noteDiv.querySelector('p').innerText;
				let headingText = noteDiv.querySelector('.media-heading').innerText.split('\n')[0];
				headingTextSplit = headingText.split(' ');
				console.log("headingTextSplit: ",headingTextSplit);
				if(headingTextSplit[1] == 'PRIVATE'){
					tempNote.private = true;
					tempNote.user = headingTextSplit[2] +' '+ headingTextSplit[3];
				}
				else{
					tempNote.private = false;
					tempNote.user = headingText;
				}
				
				tempNote.dateTimeString = noteDiv.querySelector('.pull-right').innerText;
				notes.push(tempNote);
			});
			//ticketNotesCache[ticketNumber] = notes;
			return notes;
		});
		// tab.close();
	}
	
	return ticketNotes;
}