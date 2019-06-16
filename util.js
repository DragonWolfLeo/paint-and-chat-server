const getOwnProperty = (obj, propName) => {
	if (obj.hasOwnProperty(propName)) {
		return obj[propName];
	} else {
		return undefined;
	}
}

module.exports = {
	getOwnProperty
};