var Q = require('q');
var fs = require('fs');
var strip_json_comments = require('strip-json-comments');

// Service utils classes
var ConversationStore = require('../javascript/conversation_store');
var NlcUtils = require('../javascript/nlc-utils');
var AlchemyApiUtils = require('../javascript/alchemyapi-utils');
var Pipelines = require('../javascript/pipelines/pipelines');

//************ Constructor **************//
function WatsonUtils(app) {

    // Load local config including credentials for running app locally (but services remotely)
    var configFPath = "./config/watson_config.json";
    if (fs.existsSync(configFPath)) {

        try {
            var data = fs.readFileSync(configFPath, "utf8");
            data = strip_json_comments(data);
            this.config = JSON.parse(data);
        } catch (err) {
            console.log("Unable to load local credentials.json:\n" + JSON.stringify(err));
        }
    }

    // Create Service utils classes
    this.conversationStore = new ConversationStore(this);
    this.nlcUtils = new NlcUtils(this);
    this.alchemyUtils = new AlchemyApiUtils(this);
    this.pipelines = new Pipelines();

    //************ Supported URL paths **************//
    var internalThis = this;
    app.post("/answerFactoid", function(req,res) {
        internalThis.answerFactoid(req,res);
    });
}

WatsonUtils.prototype.answerFactoid = function(req,res) {

    var startTimestamp = new Date().getTime();
    if (this.nlcUtils.isAvailableForUse()) {
        var userText = req.body.userText;
        var response = {};

        // Save conversation to a Mongo database for later analysis. Call asynchronously.
        var conversation = {"startTimestamp":startTimestamp,
                            "userText":userText};
        this.conversationStore.storeConversation(conversation);

        var internalThis = this;
        this.nlcUtils.determineUserIntent(userText)
            .then(function(nlcResponse) {

                internalThis.alchemyUtils.extractLinkedData(userText)
                    .then(function(dataLinks) {
                        if (dataLinks && dataLinks.pages.length > 0) {
                            var response = {};
                            response.dataLinks = dataLinks;
                            internalThis.pipelines.determineAnswerText(nlcResponse.top_class, dataLinks)
                                .then(function (answerText) {
                                    response.answerText = answerText;
                                    this.conversationStore.storeConversation(userText);
                                    response = JSON.stringify(response);

                                    // Save to database if enabled
                                    conversation.response = response;
                                    this.conversationStore.updateConversation(conversation);

                                    // Lastly return response to the user
                                    res.status(200).json(response);
                                }, function (err) {
                                    internalThis.handleError(res,"Failed to determine answer text for '" + userText + ". " + JSON.stringify(err));
                                });
                        }else{
                            internalThis.handleError(res,"Unsupported factoid.  No entities found");
                        }
                    }, function(err) {
                        internalThis.handleError(res,"Failed to extract dbpedia pages for '" + req.body + ". " + JSON.stringify(err));
                    });
            }, function(err) {
                internalThis.handleError(res,"Failed to extract user intent for '" + req.body + ". " + JSON.stringify(err));
            });
    }else {
        this.handleError(res,"The server is not ready yet.");
    }
}
    
WatsonUtils.prototype.handleError = function(res, errMessage) {
    var response = {
        status : 500,
        message : errMessage
    };
    /*$assistantLoading.hide();
     $assistantError.find('.errorMsg').html();
     $assistantError.show();*/
    console.log("Error occurred processing request:\n" + JSON.stringify(response));
    res.status(500).json(response);
}

// Exported class
module.exports = WatsonUtils;