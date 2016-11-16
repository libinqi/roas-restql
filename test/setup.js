'use strict';

const prepare = require('./lib/prepare')
const debug   = require('debug')('roas-restql:test:setup')

before ('database setup', function (done) {

  let sequelize = prepare.sequelize

  prepare.loadMockData().then(res => {
    debug(res);
    done()
  }).catch(done)

})
