
(function() {

	var baseRolodexUrl = "/";

	$(document).ready(function() {

		return fetchContacts("*", function(err, contacts) {
			if (err) return console.error(err);

			console.log("All Contacts", contacts);

			fetch();
		});
	});

	var fetchContactsForService = {};

	function fetch() {

		return fetchServices(function(err, services) {
			if (err) return console.error(err);

			syncServicesToDOM(services);

			for (var serviceID in fetchContactsForService) {

				// Fetch contacts once we are no longer fetching.
				if (!services[serviceID].fetching) {
					return fetchContacts(serviceID, function(err, contacts) {
						if (err) console.error(err);

						console.log("Contacts for", serviceID, contacts);

						delete fetchContactsForService[serviceID];
					});
				}
			}
		});
	}

	function syncServicesToDOM(services) {

		var fetching = false;

		function syncService(name) {

			if (services[name].fetching) {
				fetching = true;
				fetchContactsForService[name] = true;
			}

			console.log("Service Status", name, services[name]);

			var serviceHtml = null;

			if (services[name].loggedin) {

				serviceHtml = $("#service").clone();

				var html = serviceHtml.html();
				html = html.replace("{name}", name);
				html = html.replace("{fetched}", services[name].contactsFetched);
				html = html.replace("{total}", services[name].contactsTotal - services[name].contactsDropped);
				var percent = Math.floor((services[name].contactsFetched / (services[name].contactsTotal - services[name].contactsDropped)) * 100);
				if (services[name].contactsFetched === 0 || services[name].contactsTotalCapped) percent = 0;
				if (percent === 100 && services[name].fetching) percent = 99;
				if (percent === 100 && (services[name].contactsFetched + services[name].contactsDropped) < services[name].contactsTotal) percent = 99;
				html = html.replace("{percent}", percent);
				serviceHtml.html(html);

				var button = $("button.refetch", serviceHtml);
				button.click(function() {
					$.get(services[name].refetchURL).done(function() {
						fetch();
					});
				});
				button = $("button.logout", serviceHtml);
				button.click(function() {
					$.get(services[name].logoutURL).done(function() {
						fetch();
					});
				});

				if (services[name].error) {

					var error = $("DIV.error", serviceHtml);
					error.removeClass("hidden");
					error.html(services[name].error);
					serviceHtml.addClass("error");

				} else
				if (
					!services[name].fetching &&
					services[name].contactsTotal > 0 &&
					(services[name].contactsFetched + services[name].contactsDropped) === services[name].contactsTotal
				) {
					serviceHtml.addClass("fetched");
				}

			} else {

				serviceHtml = $("#service-auth").clone();
				var button = $("button.login", serviceHtml);
				button.html(button.html().replace("{name}", name));
				button.click(function() {
					authenticateForService(services[name]);
				});
			}

			serviceHtml.attr("id", "service-" + name);
			serviceHtml.removeClass("hidden");

			var existing = $("#service-" + name);
			if (existing.length === 1) {
				existing.replaceWith(serviceHtml);
			} else {
				serviceHtml.appendTo("#services");
			}
		}

		for (var name in services) {
			syncService(name);
		}

		if (fetching) {
			// Wait 5 seconds and fetch again.
			setTimeout(function() {
				fetch();
			}, 2 * 1000);
		}
	}

	function fetchServices(callback) {
		$.ajax({
			method: "GET",
			dataType: "json",
			url: baseRolodexUrl + ".openpeer-rolodex/services",
			xhrFields: {
                withCredentials: true
            },
            crossDomain: true
		}).done(function(data) {
		 	return callback(null, data);
		}).fail(callback);
	}

	function fetchContacts(serviceID, callback) {
		$.ajax({
			method: "GET",
			dataType: "json",
			url: baseRolodexUrl + ".openpeer-rolodex/contacts" + ((serviceID === "*")?"":"/"+serviceID),
			xhrFields: {
                withCredentials: true
            },
            crossDomain: true
		}).done(function(data) {
		 	return callback(null, data);
		}).fail(callback);
	}

	function authenticateForService(service) {
		$("body").append($("<form/>").attr({
			"action": service.authURL,
			"method": "POST",
			"id": "rolodex-auth-form"
		}).append($("<input/>").attr({
			"type": "hidden",
			"name": "successURL",
			"value": window.location.href.replace(/\?.*$/, "") + "?success"
		})).append($("<input/>").attr({
			"type": "hidden",
			"name": "failURL",
			"value":  window.location.href.replace(/\?.*$/, "") + "?fail"
		}))).find("#rolodex-auth-form").submit();		
	}

})();
