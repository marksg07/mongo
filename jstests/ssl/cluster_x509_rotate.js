// Check that rotation works for the cluster certificate

(function() {
    "use strict";

    load('jstests/ssl/libs/ssl_helpers.js');
    
    if (determineSSLProvider() === "openssl") {    
        return;
    }
    
    function winpath(p) {
        return p.replace(/\//g, "\\");
    }
    
    function copyfile(a, b) {
        if(_isWindows()) {
            return assert.eq(0, runProgram("cmd.exe", "/c", "copy", winpath(a), winpath(b)));
        }
        return assert.eq(0, runProgram("cp", a, b));
    }

    let mongos;
    function getConnPoolHosts() {
        const ret = mongos.adminCommand({connPoolStats: 1});
        assert.commandWorked(ret);
        jsTestLog("Connection pool stats by host: " + tojson(ret.hosts));
        return ret.hosts;
    }
    
    const dbPath = MongoRunner.toRealDir("$dataDir/cluster_x509_rotate_test/");
    mkdir(dbPath);
    
    copyfile("jstests/libs/ca.pem", dbPath + "/ca-test.pem");
    copyfile("jstests/libs/client.pem", dbPath + "/client-test.pem");
    copyfile("jstests/libs/server.pem", dbPath + "/server-test.pem");
    
    // server certificate is held constant so that shell can still connect
    const mongosOptions = {
        sslMode: "requireSSL",
        sslPEMKeyFile: "jstests/libs/server.pem",
        sslCAFile: dbPath + "/ca-test.pem",
        sslClusterFile: dbPath + "/client-test.pem",
        sslAllowInvalidHostnames: "",
    };
    
    const configOptions = {
        sslMode: "requireSSL",
        sslPEMKeyFile: dbPath + "/server-test.pem",
        sslCAFile: dbPath + "/ca-test.pem",
        sslAllowInvalidHostnames: "",
    }
    
    const sharding_config = {
        config: 1,
        mongos: 1,
        shards: 3,
        other: {
            configOptions: configOptions,
            mongosOptions: mongosOptions,
            rsOptions: configOptions,
            shardOptions: configOptions,
        }
    };

    let st = new ShardingTest(sharding_config);

    mongos = st.s0;
    // Make sure all hosts are known
    assert.soon(() => {
        mongos.adminCommand({multicast: {ping: 0}});
        return true;
    });
    
    const rst = st.rs0;
    const primary = rst.getPrimary();
    const primaryId = rst.getNodeId(primary);

    // Since we pinged, the primary should be present
    assert(primary.host in getConnPoolHosts());

    // Drop connection to the primary before killing it
    mongos.adminCommand({dropConnections: 1, hostAndPort: [primary.host]});
    assert(!(primary.host in getConnPoolHosts()));
    
    // Swap out the certificate files and rotate. If rotate works, mongos should be able to connect to the restarted shard.
    copyfile("jstests/libs/trusted-ca.pem", dbPath + "/ca-test.pem");
    copyfile("jstests/libs/trusted-client.pem", dbPath + "/client-test.pem");
    copyfile("jstests/libs/trusted-server.pem", dbPath + "/server-test.pem");
    assert.soon(() => {
        mongos.adminCommand({rotateCertificates: 1});
        return true;
    });
    
    // Can't use .restart since waitForConnect must be false. Otherwise, this would hang as the shard has an unmatching certificate.
    assert.soon(() => {
        rst.stop(primaryId, undefined, undefined, {forRestart: true});
        rst.start(primaryId, {waitForConnect: false}, true);
        return true;
    });
    
    assert.soon(() => {
        mongos.adminCommand({multicast: {ping: 0}});
        return true;
    });

    // Check for successful connection, indicating rotation successful
    assert(primary.host in getConnPoolHosts());
    jsTestLog("TEST-MSG Killing");
    //rst.stop(primary);
    jsTestLog("TEST-MSG Done");
    //primary.adminCommand({shutdown: 1, force: true});
    copyfile("jstests/libs/ca.pem", dbPath + "/ca-test.pem");
    copyfile("jstests/libs/client.pem", dbPath + "/client-test.pem");
    copyfile("jstests/libs/server.pem", dbPath + "/server-test.pem");
    mongos.adminCommand({rotateCertificates: 1});
    const host = "localhost:" + primary.port;
    runMongoProgram("mongo", "--host", host, "--ssl", "--sslAllowInvalidHostnames", "--sslPEMKeyFile", "jstests/libs/trusted-client.pem", "--sslCAFile", "jstests/libs/trusted-ca.pem", "--exec", "db.adminCommand({rotateCertificates: 1});"); // db.adminCommand({shutdown: 1, force: true});");
    rst._waitForInitialConnection(primaryId);
    jsTestLog("TEST-MSG Almost done");
    st.stop();
    jsTestLog("TEST-MSG free");
    return;    


    copyfile("jstests/libs/ca.pem", dbPath + "/ca-test.pem");
    copyfile("jstests/libs/client.pem", dbPath + "/client-test.pem");
    copyfile("jstests/libs/server.pem", dbPath + "/server-test.pem");
    mongos.adminCommand({rotateCertificates: 1});
    host = "localhost:" + primary.port;
    runMongoProgram("mongo", "--host", host, "--ssl", "--sslPEMKeyFile", "jstests/libs/trusted-client.pem", "--sslCAFile", "jstests/libs/trusted-ca.pem", "--exec", "db.adminCommand({rotateCertificates: 1}); db.adminCommand({shutdown: 1, force: true});");
    
    assert.soon(() => {
        jsTestLog("TEST-MSG kill ms");
        //mongos.adminCommand({shutdown: 1, force: true});
        runMongoProgram("mongo", "--host", "localhost:" + mongos.port, "--ssl", "--sslPEMKeyFile", "jstests/libs/client.pem", "--sslCAFile", "jstests/libs/ca.pem", "--exec", "db.adminCommand({shutdown: 1, force: true});");

        jsTestLog("TEST-MSG rot mongos");
        for (let r of rst.nodes) {
            if(r.host !== primary.host) {
                //r.adminCommand({shutdown: 1, force: true});
                runMongoProgram("mongo", "--host", "localhost:" + r.port, "--ssl", "--sslPEMKeyFile", "jstests/libs/client.pem", "--sslCAFile", "jstests/libs/ca.pem", "--exec", "db.adminCommand({shutdown: 1, force: true});");
            }
            jsTestLog("TEST-MSG rot r");
        }
        for (let c of st.configRS.nodes) {
            //c.adminCommand({shutdown: 1, force: true});
            runMongoProgram("mongo", "--host", "localhost:" + c.port, "--ssl", "--sslPEMKeyFile", "jstests/libs/client.pem", "--sslCAFile", "jstests/libs/ca.pem", "--exec", "db.adminCommand({shutdown: 1, force: true});");

            jsTestLog("TEST-MSG rot c");
        }
        jsTestLog("TEST-MSG Done");
        return true;
    });
    jsTestLog("TEST-MSG almost stoppage");
    //st.stop();

    }());
    