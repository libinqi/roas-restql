'use strict'

const _           = require('lodash');
const parse       = require('co-body');

const debug       = require('debug')('roas-restql:loaders');
const middlewares = require('./middlewares');
const methods     = require('./methods');
const common      = require('./common');

const capitalizeFirstLetter = (string) => {
  return string.charAt(0).toUpperCase() + string.slice(1)
}

const {
  switchByType
} = common;

const loaders = {}
loaders.model = {}
loaders.model.association = {}
loaders.model.association.singular             = {}
loaders.model.association.singular.hasOne      = {}
loaders.model.association.singular.belongsTo   = {}
loaders.model.association.plural               = {}
loaders.model.association.plural.hasMany       = {}
loaders.model.association.plural.belongsToMany = {}

function hasPluralAssociation (include) {

  include = include || [];

  return include.some(include => 
    include.association && include.association.isMultiAssociation);

}

/**
 * load GET /user and GET /user/:id
 */
loaders.model.get = (router, base, model, options) => {

  router.get(base, 
    middlewares.before(),
    middlewares.parseQuery(model, options),
    async function (ctx,next) {

      const {
        request, response, query
      } = ctx.restql;

      if (hasPluralAssociation(query.include)) {
        query.distinct = true;
      }
      
      response.body = await model.findAndCount(query);

      await next();

    },
    middlewares.pagination(model),
    middlewares.after());

  router.get(`${base}/:id`, 
    middlewares.before(),
    middlewares.parseQuery(model, options),
    async function (ctx,next) {

      const {
        response, query
      } = ctx.restql;

      const id = +ctx.params.id;

      response.body = await model.findById(id, query);

      if (!response.body) {
        ctx.throw(`RestQL: ${model.name} not found`, 404)
      }

      await next();

    },
    middlewares.after())

}

/**
 * load POST /user
 */
loaders.model.post = (router, base, model, options) => {

  router.post(base, 
    middlewares.before(),
    middlewares.parseRequestBody(['object', 'array']),
    middlewares.parseQuery(model, options),
    middlewares.create(model),
    middlewares.bulkCreate(model),
    middlewares.after());

}

/**
 * load PUT /user and PUT /user/:id
 */
loaders.model.put = (router, base, model, options) => {

  router.put(base, 
    middlewares.before(),
    middlewares.parseRequestBody(['object', 'array']),
    middlewares.upsert(model),
    middlewares.bulkUpsert(model),
    middlewares.after());

  router.put(`${base}/:id`, 
    middlewares.before(),
    middlewares.findById(model),
    middlewares.parseRequestBody(['object']),
    async function (ctx,next) {

      const {
        request
      } = ctx.restql;

      request.body.id = +ctx.params.id;

      await next();

    }, 
    middlewares.upsert(model),
    middlewares.after());

}

/**
 * load DELETE /user and DELETE /user/:id
 */
loaders.model.del = (router, base, model, options) => {

  router.del(base, 
    middlewares.before(),
    middlewares.parseQuery(model, options),
    middlewares.destroy(model),
    middlewares.after());

  router.del(`${base}/:id`,
    middlewares.before(),
    middlewares.findById(model),
    async function (ctx,next) {
      
      const {
        response
      } = ctx.restql;

      const id = ctx.params.id
      await model.destroy({
        where: { id }
      });

      response.status = 204 

      await next();

    },
    middlewares.after());

}

/**
 * load GET /gameofthrones/house/:id/seat or GET /gameofthrones/seat/:id/house
 */
loaders.model.association.singular.get = (router, base, model, association, options) => {

  const {
    foreignKey, as
  } = association;

  const {
    singular
  } = association.options.name;

  const get = `get${capitalizeFirstLetter(singular)}`;

  router.get(base,
    middlewares.before(),
    middlewares.parseQuery(association.target, options),
    middlewares.findById(model),
    async function (ctx,next) {

      const {
        response, query
      } = ctx.restql;

      const {
        body
      } = response;

      const data = await body[get](query);

      if (!data)
        ctx.throw(`RestQL: ${as} not found`, 404);

      response.body = data;

      await next();

    },
    middlewares.after());

}

/**
 * load PUT /gameofthrones/house/:id/seat
 */
loaders.model.association.singular.hasOne.put = (router, base, model, association, options) => {

  const {
    foreignKey, as
  } = association;

  const query = {
    include: [ association ]
  }

  router.put(base,
    middlewares.before(),
    middlewares.parseRequestBody(['object']),
    middlewares.findById(model, query),
    async function (ctx,next) {

      const {
        request, response
      } = ctx.restql;

      const {
        body
      } = response;

      const data = _.assign({}, 
        body[as] && body[as].dataValues, 
        request.body);

      data[foreignKey] = + ctx.params.id;

      request.body = data;
      await next();

    },
    middlewares.upsert(association.target),
    middlewares.after());

}

/**
 * load PUT /gameofthrones/seat/:id/house
 */
loaders.model.association.singular.belongsTo.put = (router, base, model, association, options) => {

  const {
    foreignKey, as
  } = association;

  const query = {
    include: [ association ]
  }

  router.put(base,
    middlewares.before(),
    middlewares.parseRequestBody(['object']),
    middlewares.findById(model, query),
    async function (ctx,next) {

      const {
        request, response, params
      } = ctx.restql;

      const {
        body
      } = response;

      params.data = body;

      const data = _.assign({}, 
        body[as] && body[as].dataValues,
        request.body);

      request.body = data;
      await next();

    },
    middlewares.upsert(association.target), 
    async function (ctx,next) {

      const {
        request, response, params
      } = ctx.restql;
      
      const data  = response.body;
      const value = {}

      value[foreignKey] = data.id;
      await params.data.update(value) ;

      await next();
    },
    middlewares.after());

}

/**
 * load DELETE /house/:id/seat or DELETE /seat/:id/house
 */
loaders.model.association.singular.del = (router, base, model, association, options) => {

  const {
    foreignKey, as
  } = association;

  const query = {
    include: [ association ]
  }

  router.del(base, 
    middlewares.before(),
    middlewares.findById(model, query),
    async function (ctx,next) {

      const {
        request, response
      } = ctx.restql;

      const {
        body
      } = response;

      if (!body[as]) 
        ctx.throw(`RestQL: ${model.name} ${as} not found`, 404);

      await body[as].destroy();

      response.status = 204

      await next();

    },
    middlewares.after());
}

loaders.model.association.plural.get = (router, base, model, association, options) => {

  const {
    foreignKey, as, target, through, associationType
  } = association;

  const hasManyQueryGenerator = (q, id) => {

    const query = _.cloneDeep(q);
    query.where = query.where || {}

    if (association.scope) {
      _.assign(query.where, association.scope);
    }

    query.where[foreignKey] = id;

    if (hasPluralAssociation(query.include)) {
      query.distinct = true;
    }

    return query;

  }

  const belongsToManyQueryGenerator = (q, id) => {

    const query = _.cloneDeep(q);

    let scopeWhere;

    if (association.scope) {
      scopeWhere = _.clone(association.scope);
    }

    query.where = {
      $and: [
        scopeWhere, query.where
      ]
    }

    if (through.model) {

      let throughWhere =  {}
      throughWhere[foreignKey] = id;

      if (through.scope) {
        _.assign(throughWhere, through.scope);
      }

      if (query.through && query.through.where) {
        throughWhere = {
          $and: [
            throughWhere, query.through.where
          ]
        }
      }

      query.include = query.include || [];
      query.include.push({
        association : association.oneFromTarget,
        attributes: query.joinTableAttributes,
        require : true,
        where   : throughWhere
      });

    }

    if (hasPluralAssociation(query.include)) {
      query.distinct = true;
    }

    return query;

  }

  const queryGenerators = {
    'hasMany': hasManyQueryGenerator,
    'belongsToMany': belongsToManyQueryGenerator
  }

  const associationTypeName = 
    associationType.replace(/^(.)/, $1 => $1.toLowerCase());

  const queryGenerator = queryGenerators[associationTypeName];

  router.get(base, 
    middlewares.before(),
    middlewares.parseQuery(association.target, options),
    middlewares.findById(model),
    async function (ctx,next) {

      const {
        response, params, query
      } = ctx.restql

      const {
        attributes, include
      } = query

      const {
        body
      } = response

      const parsedQuery = queryGenerator(query, body.id)

      response.body = 
        await target.findAndCount(parsedQuery);

      await next();

    },
    middlewares.pagination(association.target),
    middlewares.after());

  router.get(`${base}/:associationId`, 
    middlewares.before(),
    middlewares.parseQuery(association.target, options),
    middlewares.findById(model),
    async function (ctx,next) {

      const {
        response, params, query
      } = ctx.restql;

      const {
        body
      } = response;

      query.where    = query.where || {};
      query.where.id = +ctx.params.associationId;

      const parsedQuery = queryGenerator(query, body.id);

      const data = 
        await target.findOne(parsedQuery);

      if (!data)
        ctx.throw(`RestQL: ${model.name} not found`, 404);

      response.body = data;

      await next();

    },
    middlewares.after())

}

/**
 * load POST /user/:id/tags
 */
loaders.model.association.plural.hasMany.post = (router, base, model, association, options) => {

  const {
    foreignKey, as
  } = association;

  router.post(base, 
    middlewares.before(),
    middlewares.parseRequestBody(['object', 'array']),
    middlewares.parseQuery(model, options),
    middlewares.findById(model),
    async function (ctx,next) {

      const {
        request, response, params
      } = ctx.restql;
      
      const body = response.body;

      common.switchByType(ctx.request.body, {
        object: (data) => {
          data[foreignKey] = body.id
        },
        array: (data) => {
          data.forEach(row => row[foreignKey] = body.id)
        }
      });

     await next();

    },
    middlewares.create(association.target),
    middlewares.bulkCreate(association.target),
    middlewares.after());

}

/**
 * load POST /user/:id/characters
 */
loaders.model.association.plural.belongsToMany.post = (router, base, model, association, options) => {

  const {
    foreignKey, otherKey, as, through
  } = association;

  const {
    plural
  } = association.options.name;

  const get = `get${capitalizeFirstLetter(plural)}`;

  router.post(base, 
    middlewares.before(),
    middlewares.findById(model),
    middlewares.parseRequestBody(['object', 'array']),
    middlewares.parseQuery(model, options),
    middlewares.findOrUpsert(association.target),
    middlewares.bulkFindOrUpsert(association.target),
    async function (ctx,next) {

      const {
        request, response, params
      } = ctx.restql;

      const data = response.body;

      const getRequestRow = (foreignId, otherId) => {
        let ret = {}
        ret[foreignKey] = foreignId
        ret[otherKey]   = otherId
        return ret
      };

      const foreignId = +ctx.params.id;
      request.body = switchByType(data, {
        object : (data) => getRequestRow(foreignId, data.id),
        array  : (data) => data.map(row => getRequestRow(foreignId, row.id))
      });

      await next();

    },
    middlewares.create(through.model),
    middlewares.bulkCreate(through.model),
    async function (ctx,next) {
      
      const {
        request, response, params
      } = ctx.restql;

      let id = switchByType(response.body, {
        object : (data) => data[otherKey],
        array  : (data) => data.map(row => row[otherKey])
      });

      const data = await params.data[get]({ where: { id } });

      response.body = switchByType(request.body, {
        object : () => data[0],
        array  : () => data
      });

      await next();

    },
    middlewares.after());

}

/**
 * load PUT /user/:id/characters and PUT /user/:id/tags/:associationId
 */
loaders.model.association.plural.hasMany.put = (router, base, model, association) => {

  const {
    foreignKey
  } = association;

  router.put(base, 
    middlewares.before(),
    middlewares.parseRequestBody(['object', 'array']),
    middlewares.findById(model),
    async function (ctx,next) {

      const {
        request, response, params
      } = ctx.restql;

      const id = +ctx.params.id;

      request.body = switchByType(ctx.request.body, {
        object: (body) => {
          body[foreignKey] = id
          return body
        },
        array: (body) => {
          return body.map(row => {
            row[foreignKey] = id
            return row
          })
        }
      });

      await next();

    },
    middlewares.upsert(association.target),
    middlewares.bulkUpsert(association.target),
    middlewares.after());

  router.put(`${base}/:associationId`,
    middlewares.before(),
    middlewares.parseRequestBody(['object']),
    middlewares.findById(model),
    async function (ctx,next) {

      const {
        request, params
      } = ctx.restql;

      const associationId      = +ctx.params.associationId;
      request.body.id          = associationId;
      request.body[foreignKey] = ctx.params.id;

      await next();

    },
    middlewares.upsert(association.target),
    middlewares.after());

}

/**
 * load PUT /user/:id/tags and PUT /user/:id/tags/:associationId
 */
loaders.model.association.plural.belongsToMany.put = (router, base, model, association, options) => {

  const {
    foreignKey, otherKey, as, through
  } = association;

  const {
    plural
  } = association.options.name;

  const get = `get${capitalizeFirstLetter(plural)}`;
  const add = `add${capitalizeFirstLetter(plural)}`;

  router.put(base, 
    middlewares.before(),
    middlewares.findById(model),
    middlewares.parseRequestBody(['object', 'array']),
    middlewares.findOrUpsert(association.target),
    middlewares.bulkFindOrUpsert(association.target),
    async function (ctx,next) {

      const {
        request, response, params
      } = ctx.restql;

      const data = response.body;

      const getRequestRow = (foreignId, otherId) => {
        let ret = {}
        ret[foreignKey] = foreignId
        ret[otherKey]   = otherId
        return ret
      };

      const foreignId = +ctx.params.id;
      request.body = switchByType(data, {
        object : (data) => getRequestRow(foreignId, data.id),
        array  : (data) => data.map(row => getRequestRow(foreignId, row.id))
      });

      params.status = response.status;

      await next();

    },
    middlewares.upsert(through.model),
    middlewares.bulkUpsert(through.model),
    async function (ctx,next) {
      
      const {
        request, response, params
      } = ctx.restql;

      let id = switchByType(response.body, {
        object : (data) => data[otherKey],
        array  : (data) => data.map(row => row[otherKey])
      });

      const data = await params.data[get]({ where: { id } });

      response.body = switchByType(request.body, {
        object : () => data[0],
        array  : () => data
      });

      response.status = params.status;
      await next();

    },
    middlewares.after());

  router.put(`${base}/:associationId`,
    middlewares.before(),
    middlewares.parseRequestBody(['object']),
    middlewares.findById(model),
    async function (ctx,next) {

      const {
        request, params
      } = ctx.restql;

      const associationId = +ctx.params.associationId;
      request.body.id = associationId;

      await next();

    },
    middlewares.upsert(association.target),
    async function (ctx,next) {

      const {
        request, response, params, query
      } = ctx.restql;

      await params.data[add](response.body);

      const data = 
        await params.data[get]({ 
          where: {
            id: +ctx.params.associationId 
          }
        });

      response.body = data[0];

      await next();

    },
    middlewares.after());

}

/**
 * load DELETE /user/:id/tags and DELETE /user/:id/tags/:associationId
 */
loaders.model.association.plural.hasMany.del = (router, base, model, association, options) => {

  const {
    foreignKey, as
  } = association;
  
  router.del(base, 
    middlewares.before(),
    middlewares.findById(model),
    middlewares.parseQuery(model, options),
    async function (ctx,next) {
      
      ctx.restql.query = ctx.restql.query || {};
      const where = ctx.restql.query.where || {};

      where[foreignKey] = +ctx.params.id;
      ctx.restql.query.where = where;

      await next();

    },
    middlewares.destroy(association.target),
    middlewares.after());

  router.del(`${base}/:associationId`, 
    middlewares.before(),
    middlewares.findById(model),
    async function (ctx,next) {

      ctx.restql.query = ctx.restql.query || {};
      const where = ctx.restql.query.where || {};

      where.id          = +ctx.params.associationId;
      where[foreignKey] = +ctx.params.id;

      const data = 
        await association.target.findOne({ where });

      if (!data) {
        ctx.throw(`RestQL: ${as} cannot be found`, 404)
      }

      ctx.restql.query.where = where

      await next();

    },
    middlewares.destroy(association.target),
    middlewares.after());

}

/**
 * load DELETE /user/:id/tags and DELETE /user/:id/tags/:associationId
 */
loaders.model.association.plural.belongsToMany.del = (router, base, model, association, options) => {

  const {
    foreignKey, otherKey, as, through
  } = association;

  const {
    plural
  } = association.options.name;

  const get    = `get${capitalizeFirstLetter(plural)}`;
  const remove = `remove${capitalizeFirstLetter(plural)}`;

  router.del(base, 
    middlewares.before(),
    middlewares.findById(model),
    middlewares.parseQuery(association.target, options),
    async function (ctx,next) {

      const {
        request, response, params
      } = ctx.restql;

      const query  = ctx.restql.query;
      const data   = await params.data[get](query);

      await params.data[remove](data);

      response.status = 204;
      await next();

    },
    middlewares.after());

  router.del(`${base}/:associationId`,
    middlewares.before(),
    middlewares.findById(model),
    middlewares.parseQuery(association.target, options),
    async function (ctx,next) {

      const {
        request, response, params
      } = ctx.restql;

      const query    = ctx.restql.query;
      query.where    = {};
      query.where.id = +ctx.params.associationId;

      const data = await params.data[get](query);

      if (!data.length) {
        ctx.throw(`RestQL: ${as} not found`, 404)
      } 

      await params.data[remove](data);

      response.status = 204;
      await next();

    },
    middlewares.after());

}

module.exports = loaders
