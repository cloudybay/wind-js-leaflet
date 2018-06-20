

class WindyDataProxy {

    static getData(uri, callback) {
        fetch(uri, {method: 'get'})
            .then(response => {
                if (response.ok) {
                    return Promise.resolve(response.json());
                }
                else {
                    return Promise.reject(new Error('Failed to load'));
                }
            })
            .then(data => {
                callback(data);
            })
            .catch(function(error) {
                console.log(`Error: ${error.message}`);
            }
        )
    }

}
