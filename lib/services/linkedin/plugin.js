
const ASSERT = require("assert");
const PASSPORT_LINKEDIN = require("passport-linkedin");
const REQUEST = require("request");
const REQUESTER = require("../../requester");


exports.init = function(rolodex, passport, config, initOptions, callback) {

	try {

		if (config.passport) {
			ASSERT.equal(typeof config.passport.apiKey, "string");
			ASSERT.equal(typeof config.passport.secretKey, "string");

		    passport.use(new PASSPORT_LINKEDIN.Strategy({
		    	consumerKey: config.passport.apiKey,
			    consumerSecret: config.passport.secretKey,
			    callbackURL: config.callbackURL
			}, function(accessToken, accessTokenSecret, profile, done) {
		        return done(null, {
		            "linkedin": {
		                "id": profile.id,
		                "displayName": profile.displayName,
		                "accessToken": accessToken,
		                "accessTokenSecret": accessTokenSecret
		            }
		        });
		    }));
	   }

	    var requester = new REQUESTER();

		return callback(null, {
			passportAuthOptions: function() {
				return {
				    scope: [
				    	"r_basicprofile",
				    	"r_network"
				    ]
				};
			},
			fetchContacts: function(passportSession, service, options, callback) {

				function checkForErrors(response, callback) {
					if (
						response &&
						response.errorCode === 0 &&
						// @see http://developer.linkedin.com/documents/error-codes
						response.status === 401
					) {
						var err = new Error(response.message);
						err.code = "ACCESS_TOKEN_EXPIRED";
						return callback(err);
					}
					return callback(null);
				}

		    	function ensureUserInfo(callback) {

		    		return requester(function(callback) {

			    		initOptions.logger.info("[rolodex][linkedin] Fetch user info for: " + passportSession.displayName);

			    		var url = "http://api.linkedin.com/v1/people/~:(id,formatted-name,num-connections,num-connections-capped,picture-url)";

		    			initOptions.logger.debug("[rolodex][linkedin] fetch:", url);

						return REQUEST.get({
							url: url,
							oauth: {
								consumer_key: config.passport.consumerKey || config.passport.apiKey,
						        consumer_secret: config.passport.consumerSecret || config.passport.secretKey,
						        token: passportSession.accessToken,
						        token_secret: passportSession.accessTokenSecret
					        },
					        headers: {
					        	"x-li-format": "json"
					        },
							json: true
						}, function (err, res, user) {
							if (err) return callback(err);
							return checkForErrors(user, function(err) {
								if (err) return callback(err);

								try {
									/*
									{
										formattedName: 'Christoph Dorn',
										id: 'z06MtaTJmE',
										numConnections: 104,
										// Allows you to distinguish whether num-connections = 500 because the member has exactly 500 connections or actually 500+ because we're hiding the true value.
										numConnectionsCapped: false,
										pictureUrl: 'http://m3.licdn.com/mpr/mprx/0_IyKoXmF932tqIwRDShs7373js'
									}						
									*/

									// TODO: Add this as a full contact.

									service.set("hCard", {
										"uid": "linkedin:" + user.id,
										"nickname": null,
										"fn": user.formattedName || null,
										"photo": user.pictureUrl || null
									});
									service.set("contactsTotal", user.numConnections);
									if (service.get("contactsFetched") > service.get("contactsTotal")) {
										service.set("contactsTotal", service.get("contactsFetched"));
									}

								} catch(err) {
									initOptions.logger.error("[rolodex][linkedin] user:", user);
									return callback(err);
								}

								return callback(null);
							});
						});
		    		}, callback);
		    	}

		    	return ensureUserInfo(function(err) {
		    		if (err) return callback(err);

		    		initOptions.logger.info("[rolodex][linkedin] Fetch contacts for: " + passportSession.displayName);

		    		var contacts = service.get("contacts");
		    		var existingContacts = {};
		    		for (var contactId in contacts) {
		    			existingContacts[contactId] = true;
		    		}

		    		var contactsTotal = service.get("contactsTotal");
		    		var contactsDropped = 0;
					var updatedTotal = false;

					service.set("contactsFetched", 0);
					service.set("contactsDropped", 0);

	    			initOptions.logger.debug("[rolodex][linkedin] contactsTotal:", contactsTotal, " contactsDropped:", contactsDropped);

		    		function fetchPage(start, callback) {

			    		if (contactsTotal === 0) {
			    			// No contacts to fetch.
			    			return callback(null);
			    		}

			    		return requester(function(callback) {

			    			var url = "http://api.linkedin.com/v1/people/~/connections:(id,formatted-name,picture-url)?start=" + start + "&count=500";

			    			initOptions.logger.debug("[rolodex][linkedin] fetch:", url);

							return REQUEST.get({
								url: url,
								oauth: {
									consumer_key: config.passport.consumerKey || config.passport.apiKey,
							        consumer_secret: config.passport.consumerSecret || config.passport.secretKey,
							        token: passportSession.accessToken,
							        token_secret: passportSession.accessTokenSecret
						        },
						        headers: {
						        	"x-li-format": "json"
						        },
								json: true
							}, function (err, res, users) {
								if (err) return callback(err);
								return checkForErrors(users, function(err) {
									if (err) return callback(err);

									try {

										if (!updatedTotal && typeof users._total !== "undefined") {
											updatedTotal = true;
											contactsTotal = users._total || 0;
										}

						    			if (!users.values) {
//						    				if (users._start > 0 && users._start > (users._total - 100)) {
								    			initOptions.logger.debug("[rolodex][linkedin] No `users.values` returned but stopping gracefully anyway. Assuming linkedin API returned wrong counts:", users);
						    					return callback(null);
//						    				}
//						    				throw new Error("No `users.values` returned");
						    			}

						    			initOptions.logger.debug("[rolodex][linkedin] users.values:", users.values);

										users.values.forEach(function(user) {
											/*
											{
												formattedName: 'Jane Smith',
												// This field might return a value of private for users other than the currently logged-in user depending on the member's privacy settings
												id: 'HuQwo-xYQj',
												pictureUrl: 'http://m3.licdn.com/mpr/mprx/0_IyKoXmF932tqIwRDShs7373js'
											}
											*/

											if (user.id === "private") {
								    			initOptions.logger.debug("[rolodex][linkedin] dropped contact");
												contactsDropped += 1;
												contactsTotal -= 1;
												return;
											}

											// Sometimes linkedin returns the same contact twice.
											if (!existingContacts[user.id] && contacts[user.id]) {
								    			initOptions.logger.debug("[rolodex][linkedin] duplicate:", user.id);
												contactsTotal -= 1;
												return;
											}

											delete existingContacts[user.id];

											contacts[user.id] = {
												"uid": "linkedin:" + user.id,
												"nickname": null,
												"fn": user.formattedName || null,
												"photo": user.pictureUrl || null
											};
										});

										service.set("contactsFetched", Object.keys(contacts).length);
										service.set("contactsTotal", contactsTotal);

						    			initOptions.logger.debug("[rolodex][linkedin] contactsTotal:", contactsTotal, " contactsDropped:", contactsDropped, " contactsFetched:", service.get("contactsFetched"));

									} catch(err) {
										initOptions.logger.error("[rolodex][linkedin] users:", users);
										return callback(err);
									}

									if ((users._start + users._count) < users._total) {
										return fetchPage(users._start + users._count, callback);
									}

									return callback(null);
								});
							});
						}, callback);
		    		}

		    		return fetchPage(0, function(err) {
		    			if (err) return callback(err);

			    		for (var contactId in existingContacts) {
			    			initOptions.logger.debug("[rolodex][linkedin] delete old:", contactId);
			    			delete contacts[contactId];
			    		}

						service.set("contactsFetched", Object.keys(contacts).length);
						service.set("contactsDropped", contactsDropped);
						service.set("contactsTotal", contactsTotal);

						// Sometimes the `contactsTotal` reported by `users._total` is not correct and we need to adjust it here.
						// We adjust it if it is less than 10 off.
						if (contactsTotal > 0 && (contactsTotal-service.get("contactsFetched")) < 10) {
			    			initOptions.logger.debug("[rolodex][linkedin] Adjusted contactsTotal:", contactsTotal, " to contactsFetched:", service.get("contactsFetched"));
							service.set("contactsTotal", service.get("contactsFetched"));
						}

						// All done.
						return callback(null);
		    		});
				});
			}
		});

	} catch(err) {
		return callback(err);
	}
}
