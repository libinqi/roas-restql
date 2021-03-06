'use strict'

const qs      = require('qs')
const koa     = require('koa')
const http    = require('http')
const uuid    = require('node-uuid')
const assert  = require('assert')
const request = require('supertest')
const debug   = require('debug')('roas-restql:test:associations')

const test    = require('./lib/test')
const prepare = require('./lib/prepare')
const RestQL  = require('../lib/RestQL')

const models  = prepare.sequelize.models

describe ('model belongsTo association routers', function () {

  let server

  before (function () {

    let app = new koa()
        , restql = new RestQL(models);

    app.use(restql.routes())
    server = request(http.createServer(app.callback()))

  })

  beforeEach (function (done) {

    debug('reset db')
    prepare.loadMockData().then(() => {
      done()
    }).catch(done)  

  })

  const model       = models.seat
  const association = models.house

  describe ('GET', function () {

    it ('should return 200 | get /seat/:id/house', function (done) {

      const id = 3

      model.findById(id).then(data => {

        server
          .get(`/gameofthrones/seat/${id}/house`)
          .expect(200)
          .end((err, res) => {

            if (err) return done(err)
            let body = res.body
            assert('object' === typeof body)
            assert(body.id === data.house_id)
            done()

          })

      }).catch(done)

    })

    it ('should return 204 | get /seat/:id/house', function (done) {

      const id = 3

      model.findById(id).then(seat => {

        return seat.getHouse().then(house => {
          return house.destroy().then(() => {
            return { seat, house }
          })
        })

      }).then(res => {

        server
          .get(`/gameofthrones/seat/${id}/house`)
          .expect(204)
          .end(done)

      }).catch(done)

    })

  })

  describe ('PUT', function () {

    it ('should return 200 | put /seat/:id/house', function (done) {

      const id = 3
      const data = {
        name: uuid()
      }

      model.findById(id).then(seat => {

        server
          .put(`/gameofthrones/seat/${id}/house`)
          .send(data)
          .expect(200)
          .end((err, res) => {

            if (err) return done(err)
            let body = res.body
            assert('object' === typeof body)
            debug(body)
            assert(body.id === seat.house_id)
            test.assertObject(body, data)
            test.assertModelById(association, seat.house_id, data, done)

          })

      }).catch(done)

    })
    
    it ('should return 201 | put /seat/:id/house', function (done) {

      const id = 2
      const data = {
        name: uuid()
      }

      model.findById(id).then(seat => {
        return association.destroy({
          where: {
            id: seat.house_id
          }
        }).then((row) => {
          assert(row)
          return seat
        })
      }).then(seat => {

        server
          .put(`/gameofthrones/seat/${id}/house`)
          .send(data)
          .expect(201)
          .end((err, res) => {

            if (err) return done(err)
            let body = res.body
            assert('object' === typeof body)
            debug(body)

            model.findById(id).then(seat => {
              assert(body.id === seat.house_id)
              test.assertObject(body, data)
              test.assertModelById(association, seat.house_id, data, done)
            })

          })

      }).catch(done)

    })


  })

  describe ('DELETE', function () {

    it ('should return 204 | delete /seat/:id/house', function (done) {

      const id = 2

      model.findById(id).then(seat => {
        return association.findById(seat.house_id).then(house => {
          assert(house)
          return seat
        })
      }).then(seat => {

        server
          .del(`/gameofthrones/seat/${id}/house`)
          .expect(204)
          .end((err, res) => {

            association.findById(seat.house_id).then(data => {
              assert(!data)
              done()
            })

          })

      }).catch(done)

    })

    it ('should return 204 | delete /seat/:id/house', function (done) {

      const id = 2

      model.findById(id).then(seat => {

        return seat.getHouse().then(house => {
          return house.destroy().then(() => {
            return { seat, house }
          })
        })

      }).then(res => {

        const {
          seat, house
        } = res

        server
          .del(`/gameofthrones/seat/${seat.id}/house`)
          .expect(204)
          .end(done)

      }).catch(done)

    })

  })

})
